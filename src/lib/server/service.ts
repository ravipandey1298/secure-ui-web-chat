import 'server-only';
import { z } from 'zod';
import type { Binding, Challenge, ChatLink, Message, Session } from '../models';
import { requestPayload } from '../protocol';
import { bindingId, hash, random, validPublicKey, verify } from './crypto';
import { ApiError } from './http';
import type { Repository } from './repository';
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const publicKeySchema = z
  .object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: tokenSchema, y: tokenSchema })
  .strict();
export const signatureSchema = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
export const linkInput = z
  .object({
    customerId: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-zA-Z0-9_-]+$/),
    customerName: z.string().trim().min(1).max(80),
    channel: z.enum(['SMS', 'WHATSAPP']),
    expiryMinutes: z.number().int().min(1).max(10080),
  })
  .strict();
export class ChatService {
  constructor(
    readonly repo: Repository,
    readonly idleMs = 1800000,
    readonly absoluteMs = 7200000,
  ) {}
  async create(input: z.infer<typeof linkInput>) {
    const token = random();
    const now = this.repo.clock();
    const link: ChatLink = {
      ...input,
      id: random(),
      tokenHash: hash(token),
      status: 'PENDING',
      createdAt: now,
      expiresAt: now + input.expiryMinutes * 60000,
      blockedAttempts: 0,
      messageCount: 0,
    };
    await this.repo.create(link);
    return { token, linkId: link.id };
  }
  async activationChallenge(token: string, publicKey: JsonWebKey) {
    // Import validates the curve point before retaining any challenge.
    if (!(await validPublicKey(publicKey))) throw new ApiError('INVALID_REQUEST');
    const binding: Binding = { id: bindingId(publicKey), publicKey };
    const nonce = random();
    const expiresAt = this.repo.clock() + 60000;
    const tokenHash = hash(token);
    const challenge: Challenge = {
      kind: 'activation',
      subject: tokenHash,
      bindingId: binding.id,
      nonce,
      expiresAt,
      payload: JSON.stringify(['secure-chat-activate-v1', tokenHash, binding.id, nonce, expiresAt]),
    };
    const result = await this.repo.activationChallenge(tokenHash, challenge);
    if (result !== 'OK') throw new ApiError(result, result === 'ALREADY_USED' ? 409 : 410);
    return challenge;
  }
  async activate(token: string, publicKey: JsonWebKey, nonce: string, signature: string) {
    const challenge = await this.repo.challenge(nonce);
    const tokenHash = hash(token);
    const bid = bindingId(publicKey);
    if (
      !challenge ||
      challenge.kind !== 'activation' ||
      challenge.subject !== tokenHash ||
      challenge.bindingId !== bid ||
      challenge.expiresAt <= this.repo.clock()
    )
      throw new ApiError('CHALLENGE_INVALID', 401);
    if (!(await verify(publicKey, challenge.payload, signature))) {
      await this.repo.tx('activation-failed', this.repo.keys(tokenHash));
      throw new ApiError('DEVICE_PROOF_FAILED', 403);
    }
    const link = await this.repo.link(tokenHash);
    if (!link) throw new ApiError('INVALID_LINK', 404);
    const secret = random();
    const sessionHash = hash(secret);
    const now = this.repo.clock();
    const session: Session = {
      id: random(),
      linkHash: tokenHash,
      customerId: link.customerId,
      bindingId: bid,
      createdAt: now,
      absoluteExpiresAt: now + this.absoluteMs,
      idleExpiresAt: now + Math.min(this.idleMs, this.absoluteMs),
      revoked: false,
      started: false,
    };
    const result = await this.repo.activate(
      tokenHash,
      sessionHash,
      session,
      { id: bid, publicKey },
      nonce,
    );
    if (result !== 'OK') throw new ApiError(result, result === 'ALREADY_USED' ? 409 : 401);
    return { cookie: `${session.id}.${secret}`, sessionId: session.id };
  }
  async sessionChallenge(
    sessionHash: string,
    session: Session,
    method: string,
    path: string,
    bodyHash: string,
  ) {
    const nonce = random();
    const expiresAt = this.repo.clock() + 60000;
    const challenge: Challenge = {
      nonce,
      expiresAt,
      kind: 'session',
      subject: session.id,
      bindingId: session.bindingId,
      payload: requestPayload(session.id, method, path, bodyHash, nonce, expiresAt),
    };
    const result = await this.repo.sessionChallenge(sessionHash, session, challenge);
    if (result !== 'OK') throw new ApiError(result, 401);
    return { nonce, expiresAt, sessionId: session.id, payload: challenge.payload };
  }
  async protectedOperation(
    sessionHash: string,
    session: Session,
    nonce: string,
    signature: string,
    method: string,
    path: string,
    raw: string,
  ) {
    const challenge = await this.repo.challenge(nonce);
    const binding = await this.repo.binding(session.bindingId);
    const payload =
      challenge && requestPayload(session.id, method, path, hash(raw), nonce, challenge.expiresAt);
    if (
      !challenge ||
      challenge.kind !== 'session' ||
      challenge.subject !== session.id ||
      challenge.bindingId !== session.bindingId ||
      challenge.expiresAt <= this.repo.clock() ||
      challenge.payload !== payload ||
      !binding ||
      !(await verify(binding.publicKey, payload, signature))
    ) {
      await this.repo.event('DEVICE_PROOF_FAILED');
      throw new ApiError('DEVICE_PROOF_FAILED', 403);
    }
    let messages: Message[] = [];
    if (method === 'POST' && path === '/api/messages') {
      let text: string;
      try {
        text = z
          .object({ text: z.string().trim().min(1).max(2000) })
          .strict()
          .parse(JSON.parse(raw)).text;
      } catch {
        throw new ApiError('INVALID_REQUEST');
      }
      messages = [
        { id: random(), role: 'customer', text, createdAt: this.repo.clock() },
        {
          id: random(),
          role: 'application',
          text: 'Thanks for your message. This is an automatic acknowledgement from the secure chat demo.',
          createdAt: this.repo.clock(),
        },
      ];
    }
    const operation =
      path === '/api/session/resume' ? 'resume' : method === 'POST' ? 'send' : 'read';
    const result = await this.repo.operate(
      sessionHash,
      session,
      challenge,
      operation,
      this.idleMs,
      messages,
    );
    if (result.error)
      throw new ApiError(result.error, result.error === 'MESSAGE_LIMIT' ? 429 : 401);
    return { messages: result.messages ?? [], sessionId: session.id };
  }
}
