import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { config } from './config';
export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status = 400,
  ) {
    super(code);
  }
}
export const cookieOptions = () => ({
  httpOnly: true,
  secure: new URL(config().APP_BASE_URL).protocol === 'https:',
  sameSite: 'strict' as const,
  path: '/',
});
export function originCheck(request: Request) {
  if (
    request.headers.get('origin') !== new URL(config().APP_BASE_URL).origin ||
    request.headers.get('sec-fetch-site') === 'cross-site'
  )
    throw new ApiError('ORIGIN_REJECTED', 403);
}
export async function body(request: Request): Promise<string> {
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    throw new ApiError('JSON_REQUIRED', 415);
  if (Number(request.headers.get('content-length') ?? 0) > 16384)
    throw new ApiError('REQUEST_TOO_LARGE', 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError('INVALID_REQUEST');
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16384) {
      await reader.cancel();
      throw new ApiError('REQUEST_TOO_LARGE', 413);
    }
    chunks.push(value);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new ApiError('INVALID_REQUEST');
  }
}
export function parse<T>(schema: z.ZodType<T>, raw: string): T {
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    throw new ApiError('INVALID_REQUEST');
  }
}
export function ok(value: unknown, status = 200) {
  return NextResponse.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
}
export function errorResponse(error: unknown) {
  if (error instanceof ApiError) return ok({ error: { code: error.code } }, error.status);
  // Intentionally do not log exceptions: credential-bearing requests must stay out of logs.
  return ok({ error: { code: 'SERVICE_UNAVAILABLE' } }, 503);
}
