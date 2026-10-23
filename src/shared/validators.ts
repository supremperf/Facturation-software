/** Validateurs métier partagés (SIREN, SIRET, TVA, IBAN, BIC, e-mail…). */

export function onlyDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D+/g, '');
}

/** Algorithme de Luhn, utilisé pour SIREN (9) et SIRET (14). */
export function luhnCheck(value: string): boolean {
  const digits = onlyDigits(value);
  if (!digits) return false;
  let sum = 0;
  let shouldDouble = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let digit = Number(digits[i]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }
  return sum % 10 === 0;
}

export function isValidSiren(value: string | null | undefined): boolean {
  const digits = onlyDigits(value);
  return digits.length === 9 && luhnCheck(digits);
}

export function isValidSiret(value: string | null | undefined): boolean {
  const digits = onlyDigits(value);
  return digits.length === 14 && luhnCheck(digits);
}

export function formatSiren(value: string): string {
  const digits = onlyDigits(value);
  return digits.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3');
}

export function formatSiret(value: string): string {
  const digits = onlyDigits(value);
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{5})/, '$1 $2 $3 $4');
}

/** Numéro de TVA intracommunautaire français : FR + clé (2) + SIREN (9). */
export function isValidFrenchVatNumber(value: string | null | undefined): boolean {
  const clean = (value ?? '').replace(/[\s.-]/g, '').toUpperCase();
  if (!/^FR[0-9A-Z]{2}\d{9}$/.test(clean)) return false;
  const siren = clean.slice(4);
  if (!/^\d{9}$/.test(siren) || !luhnCheck(siren)) return false;
  const key = clean.slice(2, 4);
  if (!/^\d{2}$/.test(key)) return true; // clé alphanumérique : contrôle de forme uniquement
  const expected = (12 + 3 * (Number(siren.slice(0, 9)) % 97)) % 97;
  return Number(key) === expected;
}

export function isValidVatNumber(value: string | null | undefined): boolean {
  const clean = (value ?? '').replace(/[\s.-]/g, '').toUpperCase();
  if (!clean) return false;
  if (clean.startsWith('FR')) return isValidFrenchVatNumber(clean);
  return /^[A-Z]{2}[0-9A-Z]{2,12}$/.test(clean);
}

/** Validation IBAN (modulo 97) avec longueurs des pays les plus courants. */
const IBAN_LENGTHS: Record<string, number> = {
  FR: 27,
  BE: 16,
  LU: 20,
  DE: 22,
  ES: 24,
  IT: 27,
  NL: 18,
  PT: 25,
  CH: 21,
  GB: 22,
  MC: 27,
  AD: 24,
};

export function isValidIban(value: string | null | undefined): boolean {
  const clean = (value ?? '').replace(/[\s.-]/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(clean)) return false;
  const country = clean.slice(0, 2);
  const expectedLength = IBAN_LENGTHS[country];
  if (expectedLength && clean.length !== expectedLength) return false;
  if (clean.length < 15 || clean.length > 34) return false;
  const rearranged = clean.slice(4) + clean.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (char) => String(char.charCodeAt(0) - 55));
  let remainder = 0;
  for (let i = 0; i < numeric.length; i += 7) {
    const block = numeric.slice(i, i + 7);
    remainder = Number(String(remainder) + block) % 97;
  }
  return remainder === 1;
}

export function isValidBic(value: string | null | undefined): boolean {
  const clean = (value ?? '').replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(clean);
}

export function isValidEmail(value: string | null | undefined): boolean {
  const email = (value ?? '').trim();
  if (email.length > 254) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function isValidPhone(value: string | null | undefined): boolean {
  const clean = (value ?? '').replace(/[\s().-]/g, '');
  return /^\+?\d{6,15}$/.test(clean);
}

/** Nettoie un texte libre : retire les caractères de contrôle et limite la longueur. */
export function sanitizeText(value: string | null | undefined, maxLength = 500): string {
  if (typeof value !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').slice(0, maxLength);
}

/** Nettoie une saisie destinée à un nom de fichier. */
export function sanitizeFileName(value: string, fallback = 'document'): string {
  const cleaned = (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

/** Normalise une adresse pour comparaison (détection d'adresse de livraison identique). */
export function normalizeAddressKey(parts: (string | null | undefined)[]): string {
  return parts
    .map((p) =>
      (p ?? '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim(),
    )
    .join('|');
}
