import { createHash, randomBytes } from 'node:crypto';

/** Ingestion tokens and session ids are stored only as SHA-256 hashes (data-model.md sessions, ingestion_principals). */
export function hashToken(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** 256-bit random token, base64url (43 chars), optionally prefixed for recognisability. */
export function generateToken(prefix = ''): string {
  return prefix + randomBytes(32).toString('base64url');
}
