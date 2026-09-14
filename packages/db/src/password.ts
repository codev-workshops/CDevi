/**
 * Single owner of the password-hash format (specs/003 research R2, analysis D1). Used by the API to verify
 * sign-ins and by the seed / CLI to create accounts.
 *
 * Format: `scrypt$N$r$p$<salt base64>$<hash base64>` with N = 2^15, r = 8, p = 1, 32-byte salt, 64-byte key.
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export const SCRYPT_PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEYLEN = 64;
const MAXMEM = 128 * SCRYPT_PARAMS.N * SCRYPT_PARAMS.r * 2;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(32);
  const key = await scrypt(password, salt, KEYLEN, { ...SCRYPT_PARAMS, maxmem: MAXMEM });
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export function isPasswordHash(value: string): boolean {
  return /^scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/.test(value);
}

/** Constant-time verification. Returns false (never throws) for malformed hashes. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) return false;
  const [, n, r, p, saltB64, hashB64] = stored.split('$') as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const N = Number(n);
  const expected = Buffer.from(hashB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N,
    r: Number(r),
    p: Number(p),
    maxmem: 128 * N * Number(r) * 2,
  });
  return key.length === expected.length && timingSafeEqual(key, expected);
}
