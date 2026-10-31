import 'server-only';
import { z } from 'zod';
const schema = z.object({
  UPSTASH_REDIS_REST_URL: z.url(),
  UPSTASH_REDIS_REST_TOKEN: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(16),
  ADMIN_SESSION_SECRET: z.string().min(32),
  APP_BASE_URL: z.url(),
  LINK_EXPIRY_MINUTES: z.coerce.number().int().min(1).max(10080).default(60),
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(1).max(1440).default(30),
  SESSION_ABSOLUTE_MINUTES: z.coerce.number().int().min(1).max(10080).default(120),
});
export function config() {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) throw new Error('CONFIGURATION_UNAVAILABLE');
  const cfg = parsed.data;
  const url = new URL(cfg.APP_BASE_URL);
  if (
    process.env.NODE_ENV === 'production' &&
    url.protocol !== 'https:' &&
    !['localhost', '127.0.0.1'].includes(url.hostname)
  )
    throw new Error('HTTPS_REQUIRED');
  return cfg;
}
