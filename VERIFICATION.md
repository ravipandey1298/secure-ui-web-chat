# Verification record

Verified locally on 31 October 2026, using Node 24, Next.js production mode, real P-256 signatures, and disposable Redis 7.4.2 instances. No Upstash/Vercel credentials were supplied and no deployment was attempted.

- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 12 security tests passed against the actual Redis Lua scripts, including concurrent activation/replay, cookie/key binding, expiry/revocation, ownership, metrics and fail-closed Redis behavior.
- `npm run build`: passed with Next.js webpack mode. All pages and APIs render dynamically with per-response CSP nonces.
- `npm run test:browser`: desktop Chrome, Android Chrome emulation and iPhone viewport in Chromium; admin login, link creation, non-consuming open, activation, chat, refresh, second-browser rejection, missing/wrong private keys, CSRF rejection and revocation.
- `npm audit --omit=dev`: zero reported production advisories. The full development tree reports 16 moderate advisories inherited through ESLint/minimatch. The critical test-runner advisories were removed by upgrading Vitest. No incompatible forced dependency overrides were applied.

The browser harness uses `@upstash/redis` through a test-only REST protocol adapter to a disposable real Redis server. It does not prove actual Upstash network behavior or service quotas. The application has no production fallback or test-auth route. Test fixtures use generated throwaway credentials, disable persistence and are stopped after checks.

Pending external verification: actual Upstash REST credentials, Vercel deployment, iPhone Safari/WebKit and actual Android/SMS/WhatsApp in-app browsers. Configure `.env.local` following README before normal authenticated use. An unused bearer link remains claimable by its first possessor; this POC does not provide independent identity verification, hardware attestation, end-to-end message encryption, or banking approval.
