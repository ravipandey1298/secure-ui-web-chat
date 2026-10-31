// Standalone test harness. Never imported by application code.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { startRedisFixture, redisRestFixture } from './redis-fixture.ts';
const fixture = await startRedisFixture();
const token = randomBytes(32).toString('hex');
const rest = await redisRestFixture(fixture.store, 8079, token);
const next = spawn(
  process.execPath,
  ['node_modules/next/dist/bin/next', 'start', '--port', '3100'],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      UPSTASH_REDIS_REST_URL: 'http://127.0.0.1:8079',
      UPSTASH_REDIS_REST_TOKEN: token,
      ADMIN_PASSWORD: 'test-only-admin-password',
      ADMIN_SESSION_SECRET: randomBytes(48).toString('hex'),
      APP_BASE_URL: 'http://localhost:3100',
    },
  },
);
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  next.kill('SIGTERM');
  rest.close();
  await fixture.close();
  process.exit(0);
}
process.on('SIGINT', () => void close());
process.on('SIGTERM', () => void close());
next.on('exit', () => void close());
