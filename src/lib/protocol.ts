// Arrays give a single unambiguous representation; the exact body bytes are hashed.
export const requestPayload = (
  sessionId: string,
  method: string,
  path: string,
  bodyHash: string,
  nonce: string,
  expiresAt: number,
) => JSON.stringify(['secure-chat-v1', sessionId, method, path, bodyHash, nonce, expiresAt]);
