import fs from 'node:fs';
import path from 'node:path';

export interface AppPaths {
  base: string;
  database: string;
  databasePrevious: string;
  documents: string;
  invoices: string;
  creditNotes: string;
  branding: string;
  backups: string;
  logs: string;
  temp: string;
}

/**
 * Toutes les données persistantes vivent dans un répertoire unique
 * (%APPDATA%/FacturePro sous Windows). Aucun fichier métier n'est écrit
 * dans le dossier d'installation.
 */
export function createPaths(baseDir: string): AppPaths {
  const base = path.resolve(baseDir);
  const paths: AppPaths = {
    base,
    database: path.join(base, 'data', 'facturepro.db'),
    databasePrevious: path.join(base, 'data', 'facturepro.previous.db'),
    documents: path.join(base, 'documents'),
    invoices: path.join(base, 'documents', 'Factures'),
    creditNotes: path.join(base, 'documents', 'Avoirs'),
    branding: path.join(base, 'branding'),
    backups: path.join(base, 'backups'),
    logs: path.join(base, 'logs'),
    temp: path.join(base, 'temp'),
  };
  for (const dir of [
    path.dirname(paths.database),
    paths.documents,
    paths.invoices,
    paths.creditNotes,
    paths.branding,
    paths.backups,
    paths.logs,
    paths.temp,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return paths;
}

/** Vérifie qu'un chemin résolu reste bien à l'intérieur d'un répertoire de base. */
export function isInside(baseDir: string, candidate: string): boolean {
  const base = path.resolve(baseDir);
  const target = path.resolve(candidate);
  return target === base || target.startsWith(base + path.sep);
}

export function safeDocumentPath(baseDir: string, relativePath: string): string {
  const cleaned = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (cleaned.includes('..')) throw new Error('Chemin de document invalide.');
  const resolved = path.resolve(baseDir, cleaned);
  if (!isInside(baseDir, resolved)) throw new Error('Chemin de document hors périmètre.');
  return resolved;
}

export function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 o';
  const units = ['o', 'Ko', 'Mo', 'Go'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** index;
  return `${value.toLocaleString('fr-FR', { maximumFractionDigits: index === 0 ? 0 : 1 })} ${units[index]}`;
}
