import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { Store } from '../src/lib/server/repository';
const exec = promisify(execFile);
function decode(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
export class RedisCliStore implements Store {
  socket: string;
  cli: string;
  constructor(socket: string, cli: string) {
    this.socket = socket;
    this.cli = cli;
  }
  async command(args: (string | number)[]): Promise<unknown> {
    const { stdout } = await exec(this.cli, ['-s', this.socket, '--json', ...args.map(String)], {
      maxBuffer: 2 * 1024 * 1024,
    });
    if (stdout.startsWith('error:')) throw new Error(stdout);
    return JSON.parse(stdout);
  }
  async get<T>(key: string) {
    return decode(await this.command(['GET', key])) as T | null;
  }
  set(key: string, value: unknown, options?: { ex: number }) {
    return this.command([
      'SET',
      key,
      JSON.stringify(value),
      ...(options ? ['EX', options.ex] : []),
    ]);
  }
  del(key: string) {
    return this.command(['DEL', key]);
  }
  async eval<T>(script: string, keys: string[], args: (string | number)[]) {
    return decode(await this.command(['EVAL', script, keys.length, ...keys, ...args])) as T;
  }
  async zrange<T>(
    key: string,
    min: number | string,
    max: number | string,
    options?: { byScore?: boolean; rev?: boolean; offset?: number; count?: number },
  ) {
    return (await this.command([
      'ZRANGE',
      key,
      min,
      max,
      ...(options?.byScore ? ['BYSCORE'] : []),
      ...(options?.rev ? ['REV'] : []),
      ...(options?.count !== undefined ? ['LIMIT', options.offset ?? 0, options.count] : []),
    ])) as T;
  }
  async zcount(key: string, min: number | string, max: number | string) {
    return (await this.command(['ZCOUNT', key, min, max])) as number;
  }
  async hgetall<T>(key: string) {
    const values = await this.command(['HGETALL', key]);
    const entries = Array.isArray(values)
      ? Array.from({ length: values.length / 2 }, (_, i) => [
          values[i * 2],
          decode(values[i * 2 + 1]),
        ])
      : Object.entries(values as object).map(([k, v]) => [k, decode(v)]);
    return Object.fromEntries(entries) as T;
  }
  async lrange<T>(key: string, start: number, end: number) {
    return ((await this.command(['LRANGE', key, start, end])) as unknown[]).map(decode) as T[];
  }
}
export async function startRedisFixture() {
  const dir = await mkdtemp('/tmp/sc-test-');
  const socket = `${dir}/redis.sock`;
  const binary = process.env.TEST_REDIS_SERVER ?? 'redis-server';
  const cli = process.env.TEST_REDIS_CLI ?? 'redis-cli';
  const processHandle = spawn(
    binary,
    ['--port', '0', '--unixsocket', socket, '--save', '', '--appendonly', 'no'],
    { stdio: 'ignore' },
  );
  let failed: Error | undefined;
  processHandle.on('error', (e) => {
    failed = e;
  });
  const store = new RedisCliStore(socket, cli);
  try {
    for (let i = 0; ; i++) {
      if (failed) throw failed;
      try {
        await store.command(['PING']);
        break;
      } catch {
        if (i > 100)
          throw new Error(
            'Redis fixture cannot start. Install redis-server / redis-cli, or set TEST_REDIS_SERVER and TEST_REDIS_CLI.',
          );
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    }
  } catch (e) {
    processHandle.kill();
    await rm(dir, { recursive: true, force: true });
    throw e;
  }
  return {
    store,
    async close() {
      processHandle.kill('SIGTERM');
      await new Promise<void>((resolve) => {
        if (processHandle.exitCode !== null) resolve();
        else processHandle.once('exit', () => resolve());
      });
      await rm(dir, { recursive: true, force: true });
    },
  };
}
// Test-only Upstash REST protocol bridge. The application still uses @upstash/redis.
// It has no production route, fallback, or configuration switch.
export function redisRestFixture(store: RedisCliStore, port: number, token: string) {
  const server = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401).end();
      return;
    }
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const data = JSON.parse(Buffer.concat(chunks).toString());
      const run = async (command: (string | number)[]) => {
        try {
          const result = await store.command(command);
          // Upstash sends HGETALL as a flat RESP array.
          return {
            result:
              command[0].toString().toUpperCase() === 'HGETALL' && result && !Array.isArray(result)
                ? Object.entries(result as object).flat()
                : result,
          };
        } catch {
          return { error: 'Redis fixture command failed' };
        }
      };
      const result =
        req.url === '/pipeline' || req.url === '/multi-exec'
          ? await Promise.all(data.map(run))
          : await run(data);
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(result));
    } catch {
      res.writeHead(500).end('{}');
    }
  });
  return new Promise<typeof server>((resolve) =>
    server.listen(port, '127.0.0.1', () => resolve(server)),
  );
}
