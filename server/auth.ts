// Password hashing (Node scrypt) and session tokens (JWT via JOSE, in an HttpOnly cookie).
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';
import type { KV } from './store';

const scrypt = (pw: string, salt: Buffer, len: number, opts: { N: number; r: number; p: number }) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(pw, salt, len, { ...opts, maxmem: 64 * 1024 * 1024 }, (err, key) => (err ? reject(err) : resolve(key))),
  );

const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(pw, salt, KEYLEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt') return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length, { N: +n, r: +r, p: +p });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

export const SESSION_COOKIE = 'bs_session';
export const SESSION_DAYS = 30;

/** Uses JWT_SECRET if set; otherwise generates one and keeps it in storage (zero-config deploys). */
export async function getSigningKey(kv: KV, envSecret?: string): Promise<Uint8Array> {
  if (envSecret && envSecret.length >= 32) return new TextEncoder().encode(envSecret);
  const existing = await kv.get<{ secret: string }>('system/secret');
  if (existing) return new TextEncoder().encode(existing.data.secret);
  await kv.set('system/secret', { secret: randomBytes(48).toString('base64url') }, { onlyIfNew: true });
  const created = await kv.get<{ secret: string }>('system/secret');
  return new TextEncoder().encode(created!.data.secret);
}

export async function signSession(key: Uint8Array, userId: string, tokenVersion: number): Promise<string> {
  return new SignJWT({ tv: tokenVersion })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_DAYS}d`)
    .sign(key);
}

export async function verifySession(key: Uint8Array, token: string): Promise<{ userId: string; tv: number; iat: number } | null> {
  try {
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    if (!payload.sub || typeof payload.tv !== 'number') return null;
    return { userId: payload.sub, tv: payload.tv, iat: payload.iat ?? 0 };
  } catch {
    return null;
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function sessionCookie(req: Request, token: string | null): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  if (!token) return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}
