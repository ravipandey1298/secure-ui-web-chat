import 'server-only';
import { Redis } from '@upstash/redis';
import type {
  Binding,
  Challenge,
  ChatLink,
  Dashboard,
  EventType,
  Message,
  SecurityEvent,
  Session,
} from '../models';
import { config } from './config';
import { transaction, rateScript } from './scripts';

// This narrow interface also lets tests execute the actual scripts on a disposable Redis.
export interface Store {
  get<T>(key: string): Promise<T | null>;
  set(key: string, value: unknown, options?: { ex: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
  eval<T>(script: string, keys: string[], args: (string | number)[]): Promise<T>;
  zrange<T>(
    key: string,
    min: number | string,
    max: number | string,
    options?: { byScore?: boolean; rev?: boolean; offset?: number; count?: number },
  ): Promise<T>;
  zcount(key: string, min: number | string, max: number | string): Promise<number>;
  hgetall<T>(key: string): Promise<T | null>;
  lrange<T>(key: string, start: number, end: number): Promise<T[]>;
}
export const dateKey = (at: number) => new Date(at).toISOString().slice(0, 10);
export class Repository {
  constructor(
    readonly db: Store,
    readonly clock: () => number = Date.now,
  ) {}
  keys(
    linkHash = '',
    sessionHash = '',
    nonce = '',
    binding = '',
    sessionId = '',
    linkId = '',
    customerId = '',
  ) {
    return [
      `chat:link:${linkHash}`,
      `chat:session:${sessionHash}`,
      `chat:challenge:${nonce}`,
      `chat:binding:${binding}`,
      `chat:messages:${sessionId}`,
      'chat:metrics:total',
      `chat:metrics:daily:${dateKey(this.clock())}`,
      'chat:events:recent',
      'chat:links',
      'chat:pending',
      'chat:active',
      `chat:link-id:${linkId}`,
      `chat:customer:${customerId}`,
    ];
  }
  async tx(action: string, keys: string[], sessionHash = '', ...args: (string | number)[]) {
    return this.db.eval<string>(transaction, keys, [this.clock(), action, sessionHash, ...args]);
  }
  link(hash: string) {
    return this.db.get<ChatLink>(`chat:link:${hash}`);
  }
  session(hash: string) {
    return this.db.get<Session>(`chat:session:${hash}`);
  }
  binding(id: string) {
    return this.db.get<Binding>(`chat:binding:${id}`);
  }
  challenge(nonce: string) {
    return this.db.get<Challenge>(`chat:challenge:${nonce}`);
  }
  async event(type: EventType, linkId = '') {
    await this.tx('event', this.keys(), '', type, linkId);
  }
  async rate(subject: string, limit: number, seconds = 60) {
    return (await this.db.eval<number>(rateScript, [`chat:rate:${subject}`], [seconds])) <= limit;
  }
  async create(link: ChatLink) {
    return this.tx(
      'create',
      this.keys(link.tokenHash, '', '', '', '', link.id, link.customerId),
      '',
      JSON.stringify(link),
    );
  }
  inspect(hash: string) {
    return this.tx('inspect', this.keys(hash));
  }
  async linkById(id: string) {
    const hash = await this.db.get<string>(`chat:link-id:${id}`);
    return hash ? this.link(hash) : null;
  }
  revoke(link: ChatLink) {
    return this.tx('revoke', this.keys(link.tokenHash, link.sessionHash));
  }
  activationChallenge(hash: string, c: Challenge) {
    return this.tx('activation-challenge', this.keys(hash, '', c.nonce), '', JSON.stringify(c));
  }
  activate(hash: string, sessionHash: string, session: Session, binding: Binding, nonce: string) {
    return this.tx(
      'activate',
      this.keys(hash, sessionHash, nonce, binding.id),
      sessionHash,
      JSON.stringify(session),
      binding.id,
      JSON.stringify(binding),
    );
  }
  sessionChallenge(sessionHash: string, session: Session, c: Challenge) {
    return this.tx(
      'session-challenge',
      this.keys(session.linkHash, sessionHash, c.nonce),
      sessionHash,
      JSON.stringify(c),
    );
  }
  async operate(
    sessionHash: string,
    session: Session,
    challenge: Challenge,
    operation: 'read' | 'send' | 'resume',
    idleMs: number,
    messages: Message[] = [],
  ) {
    const result = await this.tx(
      operation,
      this.keys(session.linkHash, sessionHash, challenge.nonce, '', session.id),
      sessionHash,
      challenge.payload,
      idleMs,
      ...messages.map((m) => JSON.stringify(m)),
    );
    // Upstash auto-deserializes JSON script replies; REST fixtures may return strings.
    if (typeof result === 'string' && !result.startsWith('[') && result !== '{}')
      return { error: result };
    const raw = typeof result === 'string' ? JSON.parse(result) : result;
    return {
      messages: (Array.isArray(raw) ? raw : []).map((m: string | Message) =>
        typeof m === 'string' ? (JSON.parse(m) as Message) : m,
      ),
    };
  }
  async sweep() {
    // Bounded work. Sorted-set counts include any overdue records left for a later batch.
    const due = await this.db.zrange<string[]>('chat:pending', '-inf', this.clock(), {
      byScore: true,
      offset: 0,
      count: 100,
    });
    await Promise.all(due.map((h) => this.tx('expire', this.keys(h))));
    const sessions = await this.db.zrange<string[]>('chat:active', '-inf', this.clock(), {
      byScore: true,
      offset: 0,
      count: 100,
    });
    await Promise.all(sessions.map((h) => this.tx('expire-session', this.keys('', h), h)));
  }
  async list(offset = 0) {
    await this.sweep();
    const hashes = await this.db.zrange<string[]>('chat:links', offset, offset + 49, { rev: true });
    const links = await Promise.all(hashes.map((h) => this.link(h)));
    return links
      .filter((l): l is ChatLink => !!l)
      .map((link) => {
        // Only noncredential metadata is returned to the administrator.
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { tokenHash, sessionHash, ...l } = link;
        return {
          ...l,
          status:
            l.status === 'PENDING' && l.expiresAt <= this.clock() ? ('EXPIRED' as const) : l.status,
        };
      });
  }
  async dashboard(): Promise<Dashboard> {
    await this.sweep();
    const dates = Array.from({ length: 7 }, (_, i) => dateKey(this.clock() - (6 - i) * 86400000));
    const [totals, pending, overdue, activeSessions, events, daily] = await Promise.all([
      this.db.hgetall<Record<string, number>>('chat:metrics:total'),
      this.db.zcount('chat:pending', `(${this.clock()}`, '+inf'),
      this.db.zcount('chat:pending', '-inf', this.clock()),
      this.db.zcount('chat:active', `(${this.clock()}`, '+inf'),
      this.db.lrange<SecurityEvent>('chat:events:recent', 0, 29),
      Promise.all(
        dates.map(async (date) => ({
          date,
          counts:
            (await this.db.hgetall<Record<string, number>>(`chat:metrics:daily:${date}`)) ?? {},
        })),
      ),
    ]);
    const t = Object.fromEntries(Object.entries(totals ?? {}).map(([k, v]) => [k, Number(v)]));
    const expired = (t.LINK_EXPIRED ?? 0) - (t.REVOKED_FROM_EXPIRED ?? 0) + overdue;
    const revoked = t.LINK_REVOKED ?? 0;
    return {
      totals: t,
      distribution: {
        PENDING: pending,
        EXPIRED: expired,
        REVOKED: revoked,
        ACTIVATED: Math.max(0, (t.LINK_CREATED ?? 0) - pending - expired - revoked),
      },
      activeSessions,
      events,
      daily,
    };
  }
}
export function repository() {
  const cfg = config();
  return new Repository(
    new Redis({
      url: cfg.UPSTASH_REDIS_REST_URL,
      token: cfg.UPSTASH_REDIS_REST_TOKEN,
      automaticDeserialization: true,
    }) as unknown as Store,
  );
}
