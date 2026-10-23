import fs from 'node:fs';
import path from 'node:path';
import initSqlJs from 'sql.js';
import type { Database as SqlJsDatabase, SqlJsStatic, SqlValue } from 'sql.js';
import { MIGRATIONS, SCHEMA_VERSION } from './schema';

export type Row = Record<string, SqlValue>;

export interface DatabaseOptions {
  filePath: string;
  wasmPath: string;
  logger?: { info: (message: string) => void; warn: (message: string, error?: unknown) => void };
}

export class DatabaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DatabaseError';
  }
}

/**
 * Encapsule sql.js (SQLite compilé en WebAssembly), la persistance atomique du
 * fichier et les migrations de schéma. Aucune donnée ne quitte le poste.
 */
export class Database {
  private db: SqlJsDatabase;
  private readonly filePath: string;
  private readonly previousPath: string;
  private readonly tempPath: string;
  private readonly logger?: DatabaseOptions['logger'];
  private transactionDepth = 0;
  private recovered = false;
  private skipPreviousCopyOnce = false;
  private readonly SQL: SqlJsStatic;

  private constructor(db: SqlJsDatabase, options: DatabaseOptions, SQL: SqlJsStatic) {
    this.db = db;
    this.SQL = SQL;
    this.filePath = options.filePath;
    this.previousPath = options.filePath.replace(/\.db$/i, '.previous.db');
    this.tempPath = `${options.filePath}.tmp`;
    this.logger = options.logger;
  }

  static async open(options: DatabaseOptions): Promise<Database> {
    const SQL = await initSqlJs({
      locateFile: () => options.wasmPath,
    });
    fs.mkdirSync(path.dirname(options.filePath), { recursive: true });

    let instance: Database | null = null;
    if (fs.existsSync(options.filePath)) {
      try {
        instance = Database.loadWith(SQL, options, options.filePath);
      } catch (error) {
        options.logger?.warn('Base de données illisible, tentative de récupération.', error);
        const previousFile = options.filePath.replace(/\.db$/i, '.previous.db');
        if (fs.existsSync(previousFile)) {
          try {
            instance = Database.loadWith(SQL, options, previousFile);
            instance.recovered = true;
            instance.skipPreviousCopyOnce = true;
            instance.persist();
            options.logger?.warn(
              'Base restaurée depuis la copie de sécurité précédente. Le fichier corrompu est conservé.',
            );
          } catch (previousError) {
            options.logger?.warn('La copie de sécurité est également illisible.', previousError);
          }
        }
        if (!instance) {
          const quarantine = `${options.filePath}.corrupt-${Date.now()}`;
          try {
            fs.renameSync(options.filePath, quarantine);
            options.logger?.warn(`Base corrompue déplacée vers ${quarantine}.`);
          } catch {
            /* ignore */
          }
          instance = Database.createFresh(SQL, options);
        }
      }
    } else {
      instance = Database.createFresh(SQL, options);
    }

    instance.applyPragmas();
    instance.migrate();
    instance.persist();
    return instance;
  }

  private static createFresh(SQL: initSqlJs.SqlJsStatic, options: DatabaseOptions): Database {
    const db = new SQL.Database();
    return new Database(db, options, SQL);
  }

  private static loadWith(
    SQL: initSqlJs.SqlJsStatic,
    options: DatabaseOptions,
    filePath: string,
  ): Database {
    const bytes = fs.readFileSync(filePath);
    if (!bytes.length) throw new DatabaseError('Fichier de base vide.');
    const db = new SQL.Database(new Uint8Array(bytes));
    const instance = new Database(db, options, SQL);
    instance.applyPragmas();
    const integrity = instance.integrity();
    if (integrity !== 'ok') {
      db.close();
      throw new DatabaseError(`Base de données corrompue (${integrity}).`);
    }
    const version = instance.userVersion();
    if (version > SCHEMA_VERSION) {
      db.close();
      throw new DatabaseError(
        'Cette base a été créée par une version plus récente de FacturePro. Mettez l’application à jour.',
      );
    }
    return instance;
  }

  private applyPragmas(): void {
    this.db.run('PRAGMA foreign_keys = ON;');
  }

  get path(): string {
    return this.filePath;
  }

  get wasRecovered(): boolean {
    return this.recovered;
  }

  get schemaVersion(): number {
    return this.userVersion();
  }

  integrityCheck(): string {
    return this.integrity();
  }

  userVersion(): number {
    const result = this.db.exec('PRAGMA user_version;');
    const value = result[0]?.values?.[0]?.[0];
    return typeof value === 'number' ? value : 0;
  }

  private migrate(): void {
    const current = this.userVersion();
    if (current >= SCHEMA_VERSION) return;
    for (const migration of MIGRATIONS) {
      if (migration.version <= current) continue;
      this.db.run('BEGIN;');
      try {
        this.db.run(migration.sql);
        this.db.run(`PRAGMA user_version = ${migration.version};`);
        this.db.run('COMMIT;');
        this.logger?.info(`Migration de schéma ${migration.version} appliquée.`);
      } catch (error) {
        this.db.run('ROLLBACK;');
        throw new DatabaseError(`Migration ${migration.version} impossible : ${(error as Error).message}`);
      }
    }
  }

  integrity(): string {
    try {
      const result = this.db.exec('PRAGMA integrity_check;');
      const value = result[0]?.values?.[0]?.[0];
      return typeof value === 'string' ? value : 'unknown';
    } catch (error) {
      return (error as Error).message;
    }
  }

  all<T extends Row = Row>(sql: string, params: SqlValue[] = []): T[] {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      const rows: T[] = [];
      while (statement.step()) rows.push(statement.getAsObject() as T);
      return rows;
    } finally {
      statement.free();
    }
  }

  get<T extends Row = Row>(sql: string, params: SqlValue[] = []): T | null {
    const rows = this.all<T>(sql, params);
    return rows[0] ?? null;
  }

  scalar<T extends SqlValue = SqlValue>(sql: string, params: SqlValue[] = []): T | null {
    const statement = this.db.prepare(sql);
    try {
      statement.bind(params);
      if (!statement.step()) return null;
      const value = statement.get()[0] as T;
      return value ?? null;
    } finally {
      statement.free();
    }
  }

  run(sql: string, params: SqlValue[] = []): number {
    this.db.run(sql, params);
    return this.db.getRowsModified();
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    if (this.transactionDepth > 0) return fn();
    this.db.run('BEGIN IMMEDIATE;');
    this.transactionDepth += 1;
    try {
      const result = fn();
      this.db.run('COMMIT;');
      this.transactionDepth -= 1;
      this.persist();
      return result;
    } catch (error) {
      try {
        this.db.run('ROLLBACK;');
      } catch {
        /* ignore */
      }
      this.transactionDepth -= 1;
      throw error;
    }
  }

  /** Écrit le fichier de manière atomique (fichier temporaire, fsync, renommage). */
  persist(): void {
    const data = this.db.export();
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    if (fs.existsSync(this.filePath) && !this.skipPreviousCopyOnce) {
      try {
        fs.copyFileSync(this.filePath, this.previousPath);
      } catch (error) {
        this.logger?.warn('Copie de sécurité impossible avant écriture.', error);
      }
    }
    const fd = fs.openSync(this.tempPath, 'w');
    try {
      fs.writeSync(fd, Buffer.from(data));
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(this.tempPath, this.filePath);
    this.skipPreviousCopyOnce = false;
  }

  exportBytes(): Uint8Array {
    return this.db.export();
  }

  bytes(): Buffer {
    return Buffer.from(this.db.export());
  }

  fileSize(): number {
    try {
      return fs.statSync(this.filePath).size;
    } catch {
      return 0;
    }
  }

  tableCounts(): { name: string; rows: number }[] {
    const tables = this.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;",
    );
    return tables.map((table) => {
      const count = this.scalar<number>(`SELECT COUNT(*) FROM "${table.name}";`);
      return { name: table.name, rows: Number(count ?? 0) };
    });
  }

  /** Remplace le contenu de la base (restauration de sauvegarde validée). */
  replaceWith(bytes: Uint8Array): void {
    const candidate = new this.SQL.Database(bytes);
    try {
      candidate.run('PRAGMA foreign_keys = ON;');
      const check = candidate.exec('PRAGMA integrity_check;');
      const integrity = check[0]?.values?.[0]?.[0];
      if (integrity !== 'ok') {
        throw new DatabaseError('La sauvegarde contient une base de données corrompue.');
      }
      const versionResult = candidate.exec('PRAGMA user_version;');
      const version = Number(versionResult[0]?.values?.[0]?.[0] ?? 0);
      if (version > SCHEMA_VERSION) {
        throw new DatabaseError(
          'La sauvegarde provient d’une version plus récente de FacturePro.',
        );
      }
      if (version < SCHEMA_VERSION) {
        throw new DatabaseError(
          'La sauvegarde provient d’une version trop ancienne et doit être migrée par l’application d’origine.',
        );
      }
    } catch (error) {
      candidate.close();
      throw error;
    }
    const previous = this.db;
    this.db = candidate;
    try {
      this.persist();
    } catch (error) {
      this.db = previous;
      candidate.close();
      throw error;
    }
    previous.close();
  }

  close(): void {
    try {
      this.persist();
    } catch (error) {
      this.logger?.warn('Écriture finale impossible.', error);
    }
    this.db.close();
  }
}
