import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Repository } from '../src/lib/server/repository';
import { ChatService } from '../src/lib/server/service';
import { hash } from '../src/lib/server/crypto';
import { sessionIdentity } from '../src/lib/server/auth';
import { startRedisFixture } from './redis-fixture';
let fixture: Awaited<ReturnType<typeof startRedisFixture>>;
let repo: Repository;
let service: ChatService;
let now: number;
async function browser() {
  const pair = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'sign',
    'verify',
  ]);
  const jwk = await webcrypto.subtle.exportKey('jwk', pair.publicKey);
  const publicKey = { kty: jwk.kty!, crv: jwk.crv!, x: jwk.x!, y: jwk.y! };
  return {
    privateKey: pair.privateKey,
    publicKey,
    sign: async (payload: string) =>
      Buffer.from(
        await webcrypto.subtle.sign(
          { name: 'ECDSA', hash: 'SHA-256' },
          pair.privateKey,
          Buffer.from(payload),
        ),
      ).toString('base64url'),
  };
}
type Browser = Awaited<ReturnType<typeof browser>>;
async function invite(customerId = 'TEST-A') {
  return service.create({
    customerId,
    customerName: 'Fictional Customer',
    channel: 'SMS',
    expiryMinutes: 60,
  });
}
async function activate(token: string, b: Browser) {
  const c = await service.activationChallenge(token, b.publicKey);
  return service.activate(token, b.publicKey, c.nonce, await b.sign(c.payload));
}
async function proof(cookie: string, b: Browser, method = 'GET', path = '/api/messages', raw = '') {
  const identity = await sessionIdentity(repo, cookie);
  const c = await service.sessionChallenge(
    identity.sessionHash,
    identity.session,
    method,
    path,
    hash(raw),
  );
  const signature = await b.sign(c.payload);
  return {
    run: () =>
      service.protectedOperation(
        identity.sessionHash,
        identity.session,
        c.nonce,
        signature,
        method,
        path,
        raw,
      ),
    identity,
    c,
    signature,
  };
}
beforeAll(async () => {
  fixture = await startRedisFixture();
});
afterAll(async () => {
  await fixture?.close();
});
beforeEach(async () => {
  await fixture.store.command(['FLUSHDB']);
  now = Date.now();
  repo = new Repository(fixture.store, () => now);
  service = new ChatService(repo, 30 * 60000, 120 * 60000);
});
describe('Atomic link lifecycle and real P-256 proofs', () => {
  it('opens without consuming, activates once, and persists only the token hash', async () => {
    const b = await browser();
    const { token } = await invite();
    expect(await repo.inspect(hash(token))).toBe('PENDING');
    expect(await repo.inspect(hash(token))).toBe('PENDING');
    const activated = await activate(token, b);
    expect(activated.cookie).toContain('.');
    expect((await repo.link(hash(token)))?.status).toBe('ACTIVATED');
    const allKeys = (await fixture.store.command(['KEYS', '*'])) as string[];
    const dump = await Promise.all(
      allKeys.map(async (key) => [key, await fixture.store.command(['DUMP', key])]),
    );
    expect(JSON.stringify(dump)).not.toContain(token);
    expect(JSON.stringify(dump)).not.toContain(activated.cookie.split('.')[1]);
    expect(b.privateKey.extractable).toBe(false);
  });
  it('allows exactly one winner for two concurrent, independently signed activations', async () => {
    const a = await browser();
    const b = await browser();
    const { token } = await invite();
    const [ca, cb] = await Promise.all([
      service.activationChallenge(token, a.publicKey),
      service.activationChallenge(token, b.publicKey),
    ]);
    const results = await Promise.allSettled([
      service.activate(token, a.publicKey, ca.nonce, await a.sign(ca.payload)),
      service.activate(token, b.publicKey, cb.nonce, await b.sign(cb.payload)),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await repo.dashboard()).totals.SESSION_CREATED).toBe(1);
    expect((await repo.link(hash(token)))?.blockedAttempts).toBe(1);
  });
  it('blocks another browser on a used link', async () => {
    const { token } = await invite();
    await activate(token, await browser());
    await expect(activate(token, await browser())).rejects.toMatchObject({ code: 'ALREADY_USED' });
  });
  it('resumes the authorized browser and reads persistent messages after a service restart', async () => {
    const b = await browser();
    const { token } = await invite();
    const { cookie } = await activate(token, b);
    const sent = await (
      await proof(cookie, b, 'POST', '/api/messages', JSON.stringify({ text: 'Hello' }))
    ).run();
    expect(sent.messages).toHaveLength(2);
    service = new ChatService(new Repository(fixture.store, () => now));
    const resumed = await (await proof(cookie, b, 'POST', '/api/session/resume', '{}')).run();
    expect(resumed.messages[0].text).toBe('Hello');
    expect((await repo.dashboard()).totals.SESSION_RESUMED).toBe(1);
  });
  it('denies a copied valid cookie signed by the wrong browser key', async () => {
    const { token } = await invite();
    const { cookie } = await activate(token, await browser());
    await expect((await proof(cookie, await browser())).run()).rejects.toMatchObject({
      code: 'DEVICE_PROOF_FAILED',
    });
  });
  it('rejects an expired link', async () => {
    const { token } = await invite();
    now += 61 * 60000;
    await expect(activate(token, await browser())).rejects.toMatchObject({ code: 'EXPIRED' });
  });
  it('rejects revoked invitations and revokes an already-issued session proof', async () => {
    const b = await browser();
    const { token } = await invite();
    await repo.revoke((await repo.link(hash(token)))!);
    await expect(activate(token, b)).rejects.toMatchObject({ code: 'REVOKED' });
    const next = await invite('B');
    const { cookie } = await activate(next.token, b);
    const p = await proof(cookie, b);
    await repo.revoke((await repo.link(hash(next.token)))!);
    await expect(p.run()).rejects.toMatchObject({ code: 'SESSION_INVALID' });
    await expect(sessionIdentity(repo, cookie)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
  it('rejects replay of activation and protected request challenges, including concurrent replay', async () => {
    const b = await browser();
    const { token } = await invite();
    const c = await service.activationChallenge(token, b.publicKey);
    const signature = await b.sign(c.payload);
    const { cookie } = await service.activate(token, b.publicKey, c.nonce, signature);
    await expect(service.activate(token, b.publicKey, c.nonce, signature)).rejects.toMatchObject({
      code: 'CHALLENGE_INVALID',
    });
    const p = await proof(cookie, b);
    const results = await Promise.allSettled([p.run(), p.run()]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });
  it('keeps A and B message ownership isolated and rejects body and path tampering', async () => {
    const a = await browser();
    const b = await browser();
    const la = await invite('A');
    const lb = await invite('B');
    const sa = await activate(la.token, a);
    const sb = await activate(lb.token, b);
    await (await proof(sb.cookie, b, 'POST', '/api/messages', '{"text":"B private"}')).run();
    expect((await (await proof(sa.cookie, a)).run()).messages).toEqual([]);
    await expect((await proof(sb.cookie, a)).run()).rejects.toMatchObject({
      code: 'DEVICE_PROOF_FAILED',
    });
    const p = await proof(sa.cookie, a, 'POST', '/api/messages', '{"text":"Original"}');
    await expect(
      service.protectedOperation(
        p.identity.sessionHash,
        p.identity.session,
        p.c.nonce,
        p.signature,
        'POST',
        '/api/messages',
        '{"text":"Tampered"}',
      ),
    ).rejects.toMatchObject({ code: 'DEVICE_PROOF_FAILED' });
  });
  it('maintains exact total, unique, daily, channel, status, message and active-session metrics', async () => {
    const b = await browser();
    const a = await invite();
    const pending = await invite('PENDING');
    const expired = await invite('EXPIRED');
    await repo.inspect(hash(a.token));
    await repo.inspect(hash(a.token));
    const { cookie } = await activate(a.token, b);
    await (await proof(cookie, b, 'POST', '/api/messages', '{"text":"Test"}')).run();
    await activate(a.token, await browser()).catch(() => {});
    const link = (await repo.link(hash(expired.token)))!;
    link.expiresAt = now - 1;
    await fixture.store.set(`chat:link:${hash(expired.token)}`, link);
    await fixture.store.command(['ZADD', 'chat:pending', now - 1, hash(expired.token)]);
    let d = await repo.dashboard();
    expect(d.totals).toMatchObject({
      LINK_CREATED: 3,
      LINK_OPENED: 2,
      UNIQUE_OPENED: 1,
      LINK_ACTIVATED: 1,
      MESSAGE_SENT: 1,
      LINK_ALREADY_USED: 1,
      CHAT_STARTED: 1,
      CHANNEL_SMS: 3,
    });
    expect(d.distribution).toEqual({ PENDING: 1, ACTIVATED: 1, EXPIRED: 1, REVOKED: 0 });
    expect(d.activeSessions).toBe(1);
    expect(d.daily[6].counts.MESSAGE_SENT).toBe(1);
    await repo.revoke(link);
    await repo.revoke((await repo.link(hash(pending.token)))!);
    d = await repo.dashboard();
    expect(d.distribution).toEqual({ PENDING: 0, ACTIVATED: 1, EXPIRED: 0, REVOKED: 2 });
    now += 31 * 60000;
    d = await repo.dashboard();
    expect(d.activeSessions).toBe(0);
    expect(d.totals.SESSION_EXPIRED).toBe(1);
  });
  it('expires challenges, enforces idle and absolute expiry and rate-limits in Redis', async () => {
    const b = await browser();
    const { token } = await invite();
    const { cookie } = await activate(token, b);
    const p = await proof(cookie, b);
    now += 60001;
    await expect(p.run()).rejects.toMatchObject({ code: 'DEVICE_PROOF_FAILED' });
    now += 30 * 60000;
    await expect(sessionIdentity(repo, cookie)).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(await repo.rate('test', 1)).toBe(true);
    expect(await repo.rate('test', 1)).toBe(false);
  });
  it('counts invalid activation proofs and fails closed when Redis is unavailable', async () => {
    const b = await browser();
    const wrong = await browser();
    const { token } = await invite();
    const c = await service.activationChallenge(token, b.publicKey);
    await expect(
      service.activate(token, b.publicKey, c.nonce, await wrong.sign(c.payload)),
    ).rejects.toMatchObject({ code: 'DEVICE_PROOF_FAILED' });
    expect((await repo.link(hash(token)))?.blockedAttempts).toBe(1);
    expect((await repo.dashboard()).totals.ACTIVATION_FAILED).toBe(1);
    const unavailable = new Repository({
      ...fixture.store,
      eval: async () => {
        throw new Error('TEST_OUTAGE');
      },
    } as unknown as Repository['db']);
    await expect(
      new ChatService(unavailable).create({
        customerId: 'FAIL',
        customerName: 'Fake',
        channel: 'SMS',
        expiryMinutes: 1,
      }),
    ).rejects.toThrow('TEST_OUTAGE');
    expect((await repo.dashboard()).totals.LINK_CREATED).toBe(1);
  });
});
