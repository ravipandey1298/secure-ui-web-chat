'use client';
import type { Message } from './models';
import { requestPayload } from './protocol';
type Credential = { privateKey: CryptoKey; publicKey: JsonWebKey };
export class ClientError extends Error {
  constructor(readonly code: string) {
    super(friendly(code));
  }
}
export function friendly(code: string) {
  const messages: Record<string, string> = {
    SERVICE_UNAVAILABLE:
      'The secure service is unavailable. Check the server configuration or try again shortly.',
    NETWORK_ERROR: 'We could not reach the server. Check your connection and try again.',
    INVALID_CREDENTIALS: 'That password is incorrect. Please try again.',
    INVALID_LINK: 'This link is not valid. Ask the sender for a new secure link.',
    EXPIRED: 'This link has expired. Ask the sender for a new one.',
    ALREADY_USED:
      'This link has already been activated. Continue in the browser that first started the chat.',
    REVOKED: 'This link has been revoked by the administrator.',
    SESSION_REVOKED: 'This session has been revoked. Ask the sender for a new link.',
    SESSION_REQUIRED: 'Open your secure link to start a chat.',
    SESSION_EXPIRED: 'Your session has expired. Ask the sender for a new link.',
    SESSION_INVALID: 'Your session is no longer active. Ask the sender for a new link.',
    KEY_MISSING: 'This browser has no chat key. Use the original browser, or ask for a new link.',
    STORAGE_UNAVAILABLE:
      'Secure browser storage is unavailable. Open this link in Safari or Chrome with browser storage enabled.',
    DEVICE_PROOF_FAILED:
      'This browser could not prove access to the chat. Use the original browser.',
    DEVICE_PROOF_REQUIRED: 'A browser security proof is required.',
    CHALLENGE_INVALID: 'The security check expired or was already used. Please try again.',
    RATE_LIMITED: 'Too many requests. Please wait a minute and try again.',
    MESSAGE_LIMIT: 'This demo conversation has reached its message limit. Ask for a new link.',
    ORIGIN_REJECTED:
      'The app address does not match APP_BASE_URL. Ask the administrator to check the configuration.',
    ADMIN_REQUIRED: 'Please sign in again to continue.',
  };
  return messages[code] ?? 'The request could not be completed. Please try again.';
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...options.headers },
    });
  } catch {
    throw new ClientError('NETWORK_ERROR');
  }
  const data = await response.json().catch(() => ({ error: { code: 'SERVICE_UNAVAILABLE' } }));
  if (!response.ok) throw new ClientError(data.error?.code ?? 'SERVICE_UNAVAILABLE');
  return data as T;
}
export const post = <T>(path: string, value: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(value) });
function database(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.isSecureContext || !globalThis.crypto?.subtle || !globalThis.indexedDB)
      return reject(new ClientError('STORAGE_UNAVAILABLE'));
    const req = indexedDB.open('secure-chat-credential', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('keys');
    req.onsuccess = () => resolve(req.result);
    req.onerror = req.onblocked = () => reject(new ClientError('STORAGE_UNAVAILABLE'));
  });
}
async function readCredential(): Promise<Credential | undefined> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('keys', 'readonly');
    const req = tx.objectStore('keys').get('browser');
    tx.oncomplete = () => {
      db.close();
      resolve(req.result);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(new ClientError('STORAGE_UNAVAILABLE'));
    };
  });
}
export async function credential(create = false): Promise<Credential> {
  try {
    const found = await readCredential();
    if (found) return found;
    if (!create) throw new ClientError('KEY_MISSING');
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ]);
    const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const value: Credential = {
      privateKey: pair.privateKey,
      publicKey: { kty: publicKey.kty, crv: publicKey.crv, x: publicKey.x, y: publicKey.y },
    };
    const db = await database();
    return await new Promise<Credential>((resolve, reject) => {
      const tx = db.transaction('keys', 'readwrite');
      const store = tx.objectStore('keys');
      const existing = store.get('browser');
      let selected = value;
      existing.onsuccess = () => {
        if (existing.result) selected = existing.result;
        else store.put(value, 'browser');
      };
      tx.oncomplete = () => {
        db.close();
        resolve(selected);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(new ClientError('STORAGE_UNAVAILABLE'));
      };
    });
  } catch (error) {
    if (error instanceof ClientError) throw error;
    throw new ClientError('STORAGE_UNAVAILABLE');
  }
}
export async function sign(key: CryptoKey, payload: string) {
  const bytes = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      new TextEncoder().encode(payload),
    ),
  );
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}
async function digest(value: string) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))),
  )
    .map((x) => x.toString(16).padStart(2, '0'))
    .join('');
}
export async function protectedRequest(
  path: '/api/messages' | '/api/session/resume',
  method: 'GET' | 'POST',
  value?: unknown,
) {
  const key = await credential();
  const raw = method === 'POST' ? JSON.stringify(value ?? {}) : '';
  const bodyHash = await digest(raw);
  const challenge = await post<{
    nonce: string;
    expiresAt: number;
    sessionId: string;
    payload: string;
  }>('/api/session/challenge', { method, path, bodyHash });
  const payload = requestPayload(
    challenge.sessionId,
    method,
    path,
    bodyHash,
    challenge.nonce,
    challenge.expiresAt,
  );
  if (payload !== challenge.payload) throw new ClientError('DEVICE_PROOF_FAILED');
  const signature = await sign(key.privateKey, payload);
  return api<{ messages: Message[]; sessionId: string }>(path, {
    method,
    ...(method === 'POST' ? { body: raw } : {}),
    headers: { 'X-Chat-Nonce': challenge.nonce, 'X-Chat-Proof': signature },
  });
}
