import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
export const SESSION_COOKIE = 'fund_sales_session';
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    const error = new Error('密码长度必须为 8-128 位');
    error.status = 400;
    throw error;
  }
}

export async function hashPassword(password) {
  validatePassword(password);
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt.toString('base64')}$${Buffer.from(derived).toString('base64')}`;
}

export async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, r, p, saltValue, hashValue] = String(encoded || '').split('$');
    if (algorithm !== 'scrypt') return false;
    const expected = Buffer.from(hashValue, 'base64');
    const actual = Buffer.from(await scrypt(String(password || ''), Buffer.from(saltValue, 'base64'), expected.length, {
      N: Number(n), r: Number(r), p: Number(p)
    }));
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const separator = part.indexOf('=');
    const key = separator < 0 ? part : part.slice(0, separator);
    const value = separator < 0 ? '' : part.slice(separator + 1);
    try { return [decodeURIComponent(key), decodeURIComponent(value)]; }
    catch { return [key, value]; }
  }));
}

export function newSession() {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: sessionTokenHash(token), expiresAt: new Date(Date.now() + SESSION_TTL_MS) };
}

export function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function sessionCookie(token, { secure = process.env.NODE_ENV === 'production' } = {}) {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function expiredSessionCookie({ secure = process.env.NODE_ENV === 'production' } = {}) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function publicUser(row) {
  return { id: row.id, name: row.name, email: row.email, createdAt: row.created_at };
}
