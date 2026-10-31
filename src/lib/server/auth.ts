import 'server-only';
import { cookies } from 'next/headers';
import { config } from './config';
import { equal, hash, mac, random } from './crypto';
import { ApiError } from './http';
import { repository, type Repository } from './repository';
export const ADMIN_COOKIE = 'chat_admin';
export const SESSION_COOKIE = 'chat_session';
export async function createAdmin(repo: Repository) {
  const id = random();
  const expires = Date.now() + 8 * 3600000;
  const value = `${id}.${expires}`;
  await repo.db.set(`chat:admin:${hash(id)}`, true, { ex: 8 * 3600 });
  return `${value}.${mac(value, config().ADMIN_SESSION_SECRET)}`;
}
export async function adminAuthenticated(repo = repository()) {
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (!raw) return false;
  const parts = raw.split('.');
  if (parts.length !== 3) return false;
  const [id, expires, signature] = parts;
  if (
    !/^\d+$/.test(expires) ||
    Number(expires) <= Date.now() ||
    !equal(signature, mac(`${id}.${expires}`, config().ADMIN_SESSION_SECRET))
  )
    return false;
  return !!(await repo.db.get(`chat:admin:${hash(id)}`));
}
export async function requireAdmin(repo: Repository) {
  if (!(await adminAuthenticated(repo))) {
    await repo.event('UNAUTHORIZED_ACCESS_BLOCKED');
    throw new ApiError('ADMIN_REQUIRED', 401);
  }
}
export async function destroyAdmin(repo: Repository) {
  const raw = (await cookies()).get(ADMIN_COOKIE)?.value;
  if (raw) await repo.db.del(`chat:admin:${hash(raw.split('.')[0])}`);
}
export async function sessionIdentity(repo: Repository, cookie?: string) {
  const raw = cookie ?? (await cookies()).get(SESSION_COOKIE)?.value;
  if (!raw || !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(raw))
    throw new ApiError('SESSION_REQUIRED', 401);
  const [id, secret] = raw.split('.');
  const sessionHash = hash(secret);
  const session = await repo.session(sessionHash);
  if (
    !session ||
    session.id !== id ||
    session.revoked ||
    session.absoluteExpiresAt <= repo.clock() ||
    session.idleExpiresAt <= repo.clock()
  )
    throw new ApiError('SESSION_EXPIRED', 401);
  const link = await repo.link(session.linkHash);
  if (!link || link.status !== 'ACTIVATED' || link.sessionHash !== sessionHash)
    throw new ApiError('SESSION_REVOKED', 401);
  return { sessionHash, session };
}
