import { NextRequest } from 'next/server';
import { z } from 'zod';
import { config } from '@/lib/server/config';
import { repository } from '@/lib/server/repository';
import {
  ChatService,
  linkInput,
  publicKeySchema,
  signatureSchema,
  tokenSchema,
} from '@/lib/server/service';
import {
  ApiError,
  body,
  cookieOptions,
  errorResponse,
  ok,
  originCheck,
  parse,
} from '@/lib/server/http';
import {
  ADMIN_COOKIE,
  SESSION_COOKIE,
  createAdmin,
  destroyAdmin,
  requireAdmin,
  sessionIdentity,
} from '@/lib/server/auth';
import { equal, hash } from '@/lib/server/crypto';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handle(req: NextRequest) {
  try {
    const cfg = config();
    const repo = repository();
    const service = new ChatService(
      repo,
      cfg.SESSION_IDLE_MINUTES * 60000,
      cfg.SESSION_ABSOLUTE_MINUTES * 60000,
    );
    const path = req.nextUrl.pathname;
    const method = req.method;
    if (!['GET', 'POST'].includes(method)) throw new ApiError('METHOD_NOT_ALLOWED', 405);
    if (req.nextUrl.search && path !== '/api/admin/links') throw new ApiError('INVALID_REQUEST');
    if (method === 'POST') originCheck(req);
    // IP is only an abuse-throttling hint, never a browser credential.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    if (!(await repo.rate(`ip:${hash(ip)}`, 180))) throw new ApiError('RATE_LIMITED', 429);
    const raw = method === 'POST' ? await body(req) : '';
    if (path === '/api/admin/login' && method === 'POST') {
      if (
        !(await repo.rate(`login:${hash(ip)}`, 10, 900)) ||
        !(await repo.rate('login:global', 100, 900))
      )
        throw new ApiError('RATE_LIMITED', 429);
      const { password } = parse(z.object({ password: z.string().max(512) }).strict(), raw);
      if (!equal(hash(password), hash(cfg.ADMIN_PASSWORD))) {
        await repo.event('UNAUTHORIZED_ACCESS_BLOCKED');
        throw new ApiError('INVALID_CREDENTIALS', 401);
      }
      const res = ok({ ok: true });
      res.cookies.set(ADMIN_COOKIE, await createAdmin(repo), {
        ...cookieOptions(),
        maxAge: 8 * 3600,
      });
      return res;
    }
    if (path.startsWith('/api/admin/')) {
      await requireAdmin(repo);
      if (path === '/api/admin/logout' && method === 'POST') {
        await destroyAdmin(repo);
        const res = ok({ ok: true });
        res.cookies.set(ADMIN_COOKIE, '', { ...cookieOptions(), maxAge: 0 });
        return res;
      }
      if (path === '/api/admin/dashboard' && method === 'GET') return ok(await repo.dashboard());
      if (path === '/api/admin/links' && method === 'GET') {
        const offset = z.coerce
          .number()
          .int()
          .min(0)
          .max(1000000)
          .safeParse(req.nextUrl.searchParams.get('offset') ?? 0);
        if (!offset.success) throw new ApiError('INVALID_REQUEST');
        return ok({ links: await repo.list(offset.data) });
      }
      if (path === '/api/admin/links' && method === 'POST') {
        const result = await service.create(parse(linkInput, raw));
        return ok(
          {
            linkId: result.linkId,
            url: `${new URL(cfg.APP_BASE_URL).origin}/start#t=${result.token}`,
          },
          201,
        );
      }
      if (path === '/api/admin/revoke' && method === 'POST') {
        const { linkId } = parse(z.object({ linkId: tokenSchema }).strict(), raw);
        const link = await repo.linkById(linkId);
        if (!link) throw new ApiError('INVALID_LINK', 404);
        await repo.revoke(link);
        return ok({ ok: true });
      }
      throw new ApiError('NOT_FOUND', 404);
    }
    if (path === '/api/links/inspect' && method === 'POST') {
      const { token } = parse(z.object({ token: tokenSchema }).strict(), raw);
      const status = await repo.inspect(hash(token));
      if (status === 'INVALID_LINK') throw new ApiError('INVALID_LINK', 404);
      return ok({ status });
    }
    if (path === '/api/activation/challenge' && method === 'POST') {
      const { token, publicKey } = parse(
        z.object({ token: tokenSchema, publicKey: publicKeySchema }).strict(),
        raw,
      );
      if (!(await repo.rate(`activate:${hash(token)}`, 15)))
        throw new ApiError('RATE_LIMITED', 429);
      return ok(await service.activationChallenge(token, publicKey));
    }
    if (path === '/api/activation/verify' && method === 'POST') {
      const { token, publicKey, nonce, signature } = parse(
        z
          .object({
            token: tokenSchema,
            publicKey: publicKeySchema,
            nonce: tokenSchema,
            signature: signatureSchema,
          })
          .strict(),
        raw,
      );
      const result = await service.activate(token, publicKey, nonce, signature);
      const res = ok({ sessionId: result.sessionId });
      res.cookies.set(SESSION_COOKIE, result.cookie, {
        ...cookieOptions(),
        maxAge: cfg.SESSION_ABSOLUTE_MINUTES * 60,
      });
      return res;
    }
    const identity = await sessionIdentity(repo).catch(async (error) => {
      await repo.event('UNAUTHORIZED_ACCESS_BLOCKED');
      throw error;
    });
    const { sessionHash, session } = identity;
    if (!(await repo.rate(`session:${sessionHash}`, 100))) throw new ApiError('RATE_LIMITED', 429);
    if (path === '/api/session/challenge' && method === 'POST') {
      const input = parse(
        z
          .object({
            method: z.enum(['GET', 'POST']),
            path: z.enum(['/api/messages', '/api/session/resume']),
            bodyHash: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
        raw,
      );
      if (input.path === '/api/session/resume' && input.method !== 'POST')
        throw new ApiError('INVALID_REQUEST');
      return ok(
        await service.sessionChallenge(
          sessionHash,
          session,
          input.method,
          input.path,
          input.bodyHash,
        ),
      );
    }
    if (
      (path === '/api/messages' && ['GET', 'POST'].includes(method)) ||
      (path === '/api/session/resume' && method === 'POST')
    ) {
      const nonce = tokenSchema.safeParse(req.headers.get('x-chat-nonce'));
      const signature = signatureSchema.safeParse(req.headers.get('x-chat-proof'));
      if (!nonce.success || !signature.success) {
        await repo.event('DEVICE_PROOF_FAILED');
        throw new ApiError('DEVICE_PROOF_REQUIRED', 403);
      }
      return ok(
        await service.protectedOperation(
          sessionHash,
          session,
          nonce.data,
          signature.data,
          method,
          path,
          raw,
        ),
      );
    }
    throw new ApiError('NOT_FOUND', 404);
  } catch (error) {
    return errorResponse(error);
  }
}
export const GET = handle;
export const POST = handle;
