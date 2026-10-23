/**
 * Erreur métier : porte un code stable, exploitable par l'interface et par
 * l'enveloppe IPC, indépendamment du texte affiché à l'utilisateur.
 *
 * Ce module est volontairement isolé (aucun import) pour pouvoir être utilisé
 * par la couche base de données comme par la couche services sans créer de
 * cycle de dépendances.
 */
export type AppErrorCode =
  | 'VALIDATION'
  | 'NOT_FOUND'
  | 'IMMUTABLE'
  | 'ALREADY_ISSUED'
  | 'DRAFT'
  | 'COMPLIANCE'
  | 'CREDIT_LIMIT'
  | 'CREDIT_AMOUNT'
  | 'PAYMENT_LIMIT'
  | 'NUMBERING'
  | 'PDF_EXISTS'
  | 'PDF_MISSING'
  | 'NO_PDF'
  | 'OPEN_FAILED'
  | 'INVALID_URL'
  | 'INVALID_BACKUP'
  | 'BACKUP_INVALID'
  | 'APP_ERROR';

/** Codes produits directement par la couche IPC (hors exceptions). */
export type IpcErrorCode = AppErrorCode | 'UNKNOWN_CHANNEL' | 'INTERNAL';

export class AppError extends Error {
  constructor(
    message: string,
    readonly code: AppErrorCode = 'APP_ERROR',
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}
