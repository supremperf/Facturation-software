import fs from 'node:fs';
import path from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, meta?: unknown): void;
  info(message: string, meta?: unknown): void;
  warn(message: string, meta?: unknown): void;
  error(message: string, meta?: unknown): void;
}

export function createLogger(logsDir: string | null, scope = 'app'): Logger {
  let filePath: string | null = null;
  if (logsDir) {
    try {
      fs.mkdirSync(logsDir, { recursive: true });
      filePath = path.join(logsDir, 'facturepro.log');
      if (fs.existsSync(filePath) && fs.statSync(filePath).size > 2 * 1024 * 1024) {
        fs.renameSync(filePath, path.join(logsDir, 'facturepro.1.log'));
      }
    } catch {
      filePath = null;
    }
  }

  const write = (level: LogLevel, message: string, meta?: unknown) => {
    const line = `${new Date().toISOString()} [${level.toUpperCase()}] [${scope}] ${message}${
      meta === undefined ? '' : ` ${safeMeta(meta)}`
    }`;
    if (level === 'error') console.error(line);
    else if (level === 'warn') console.warn(line);
    else console.log(line);
    if (filePath) {
      try {
        fs.appendFileSync(filePath, `${line}\n`, 'utf8');
      } catch {
        /* la journalisation ne doit jamais faire échouer l'application */
      }
    }
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
  };
}

function safeMeta(meta: unknown): string {
  try {
    if (meta instanceof Error) return `${meta.name}: ${meta.message}`;
    return JSON.stringify(meta);
  } catch {
    return '[meta non sérialisable]';
  }
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};
