import 'server-only';
import { createHash, createHmac, randomBytes, timingSafeEqual, webcrypto } from 'node:crypto';
export const random = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const mac = (value: string, secret: string) =>
  createHmac('sha256', secret).update(value).digest('base64url');
export function equal(a: string, b: string) {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function bindingId(key: JsonWebKey) {
  return hash(JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y }));
}
export async function validPublicKey(key: JsonWebKey) {
  try {
    if (key.kty !== 'EC' || key.crv !== 'P-256' || key.d) return false;
    await webcrypto.subtle.importKey('jwk', key, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'verify',
    ]);
    return true;
  } catch {
    return false;
  }
}
export async function verify(key: JsonWebKey, payload: string, signature: string) {
  try {
    if (
      key.kty !== 'EC' ||
      key.crv !== 'P-256' ||
      key.d ||
      Buffer.from(signature, 'base64url').length !== 64
    )
      return false;
    const imported = await webcrypto.subtle.importKey(
      'jwk',
      key,
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    return await webcrypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      imported,
      Buffer.from(signature, 'base64url'),
      Buffer.from(payload),
    );
  } catch {
    return false;
  }
}
