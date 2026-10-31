# SecurLink — one-time customer chat POC

A complete Next.js App Router application with a password-protected admin workspace, one-time invitations, ECDSA browser binding, persistent Redis metrics, and a mobile chat interface. TypeScript is the only application language; small embedded Lua scripts execute conditional state changes inside Redis.

**Use fictional information only. This POC is not approved for real customer banking data.** Anyone possessing an unused link can be its first claimant. Binding prevents reuse after activation; it does not independently identify that first person, establish a guaranteed hardware identity, or prevent compromise of an authorized browser. Messages are protected by HTTPS in transit, but are **not end-to-end encrypted**; the server/database can read them.

## Run locally

Requirements: Node.js 24 LTS (minimum 22.18), npm, and an Upstash Redis database. A local Redis server is needed only for automated tests, not to run the application.

1. Create a Redis database in the [Upstash Console](https://console.upstash.com/). Choose the Free plan and a region near your eventual Vercel function region.
2. On the database details page, find **REST API** and copy `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Use the full read/write token, not a read-only token. Keep both server-side.
3. Configure the project:

   ```sh
   npm ci
   cp .env.example .env.local
   ```

4. Generate two separate random values, running this command once for each value:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Put the first in `ADMIN_PASSWORD`, the second in `ADMIN_SESSION_SECRET`. The app requires a password of at least 16 characters and signing secret of at least 32 characters. Never commit `.env.local`; never use `NEXT_PUBLIC_` for these values.

5. Fill every variable in `.env.local`:

   ```dotenv
   UPSTASH_REDIS_REST_URL=https://YOUR-DATABASE.upstash.io
   UPSTASH_REDIS_REST_TOKEN=YOUR-WRITE-TOKEN
   ADMIN_PASSWORD=YOUR-FIRST-RANDOM-VALUE
   ADMIN_SESSION_SECRET=YOUR-SECOND-RANDOM-VALUE
   APP_BASE_URL=http://localhost:3000
   LINK_EXPIRY_MINUTES=60
   SESSION_IDLE_MINUTES=30
   SESSION_ABSOLUTE_MINUTES=120
   ```

6. Start:

   ```sh
   npm run dev
   ```

7. Visit [the admin login](http://localhost:3000/admin/login), enter `ADMIN_PASSWORD`, and open **Customer links**. Enter a fictional customer, choose SMS or WhatsApp, set expiry in minutes, and generate a link. Copy it before leaving the page: the full link is only shown at creation. No SMS/WhatsApp provider is contacted.

`APP_BASE_URL` must be the exact origin used in your browser, including the port. Origin mismatch returns `ORIGIN_REJECTED`. Restart after changing environment variables. `http://localhost` is a browser secure context and uses non-Secure cookies for practical local development; HTTPS origins use Secure cookies. A plain HTTP LAN address on a phone is not a secure context. Use a Vercel HTTPS deployment for mobile testing. Builds use webpack to avoid Turbopack worker-port restrictions in constrained environments.

Missing configuration or unavailable Redis returns a generic 503. Admin pages deny access, and activation/chat operations fail closed. There is no in-memory production fallback or demo authentication bypass.

## Walk through the POC

1. Generate a link in `/admin/links`; open it in **Browser A**. The fragment is captured into memory and removed from the address bar before API calls. Opening records a measured browser event but leaves the invitation pending.
2. Click **Start Secure Chat**. A non-extractable P-256 private key is generated and stored as a structured-cloned `CryptoKey` in IndexedDB. Its public JWK is registered after a signed, one-time activation challenge.
3. Send a message. The application stores it and a sample automatic acknowledgement. There is no AI or WhatsApp integration.
4. Refresh `/chat`; the key and HttpOnly cookie enable a fresh proof and resume. `/start` without a fragment also offers an existing valid session after verifying the browser key.
5. Open the original link in **Browser B** (a separate browser or a genuinely separate private context). It reports that the link has already been used. A second tab sharing Browser A's cookie and IndexedDB is still the same browser context.
6. Delete Browser A's IndexedDB credential or copy its session cookie into a clean context. Protected chat requests fail without the correct key; the application does not silently generate a replacement key for an existing session.
7. Revoke the link in the admin table. Its active session is immediately blocked server-side, including challenges issued before revocation. The customer sees this on their next request/poll.
8. Open **Overview** to see persistent counters, seven UTC days of activity, status distribution, channel counts, and recent events. The dashboard polls every 15 seconds while visible; chat polls every 10 seconds while visible. Hidden tabs stop polling.

If the customer refreshes `/start` **before** activation, the in-memory fragment is intentionally gone: reopen the original invitation. If activation has succeeded, the valid browser session can resume. Clearing storage, changing origin/domain, using private browsing, or losing the cookie/key requires a new controlled invitation. There is no device rebinding or recovery bypass.

Safari, Chrome, and SMS/WhatsApp in-app browsers may use isolated storage, even on the same physical phone. Open and continue in the same browser. Some in-app/private modes disable or evict IndexedDB; use Safari or Chrome when secure storage is unavailable. Current browsers supporting Next.js, secure-context Web Crypto, and structured-cloned `CryptoKey` storage are required. Test actual target devices before any pilot; emulated viewports do not establish Safari or in-app browser compatibility.

## Architecture and security flow

The App Router serves all pages and Route Handler APIs. `src/lib/server/` is protected with `server-only`; Redis credentials, admin authentication, token hashing, signature verification, and authorization stay on the server. `@upstash/redis` communicates with the same managed Redis over REST locally and on Vercel. No local files or process memory hold authoritative application data.

### Link lifecycle

`PENDING → ACTIVATED` occurs exactly once via Lua `EVAL`. Pending links can instead become `EXPIRED`; any link can become `REVOKED`. Expiry of an invitation applies **before activation**. An activated session has independent idle/absolute deadlines and can be revoked through its originating link. Admin table status describes the link, not whether its session is still active.

Generation uses 32 cryptographically random bytes and base64url encoding (256 bits). Only its SHA-256 hash identifies the Redis record. The raw URL token appears in the creation response and browser memory, never in application cookies, localStorage, Redis, analytics, or security events. The fragment is not sent in HTTP request URLs. Application code never logs request bodies or credentials. Browser history, clipboard, transport providers, infrastructure logging settings, and test/debug tooling still require careful handling.

Activation challenges last 60 seconds and bind the token hash, SHA-256 public-key thumbprint, nonce, and expiry. The server validates the P-256 curve point and verifies the ECDSA/SHA-256 signature in IEEE P1363 format. The redemption script rechecks link status and expiry, validates and consumes the challenge, saves the binding/session, and commits metrics in one atomic operation. Independent simultaneous valid claims produce only one session.

Session cookies contain a random session ID and separate random 256-bit secret. Redis stores only the secret's hash, not the secret. For each protected operation the server issues a challenge. The browser signs this exact JSON array:

```text
["secure-chat-v1", sessionId, HTTP_METHOD, exactPath, sha256(exactBodyBytes), nonce, expiresAt]
```

The server verifies the signature against the registered public key. A Lua script rechecks link/session status and both session deadlines, consumes the matching challenge, then reads/writes the server-owned message list. Every read/write needs both cookie authentication and key proof. Browser-supplied customer IDs and session IDs never select message ownership. Signatures cannot be reused across sessions, methods, paths, bodies, or nonces. `/api/session/resume` is the explicit proof-verification/resume endpoint; there is no unprotected chat read endpoint.

Admin cookies are HMAC-SHA-256 signed with an eight-hour deadline and backed by a hashed, expiring Redis session ID. Every admin API and dashboard server render validates both signature and Redis session. Logout deletes that Redis session. Both cookie types are HttpOnly, SameSite=Strict, and Secure on HTTPS. No password is exposed to client code. Admin password comparisons use constant-time comparison of fixed-size hashes; the password itself comes only from server configuration.

All POST requests require an exact configured Origin, rejecting missing/cross-site origins. No GET activates/revokes/sends anything. Payloads are streamed with a 16 KiB cap and validated using Zod; customer messages are capped at 2,000 characters, 500 customer messages per conversation, and history responses at the latest 200 entries including replies. Request throttles use Redis counters with TTLs (180/IP/minute, 100/session/minute, 15 activation challenges/link/minute, 10 login attempts/IP/15 minutes and 100 globally/15 minutes). Forwarded IP is an abuse hint only, never an identity credential; untrusted self-hosting proxies should sanitize it.

Responses are no-store; referrers are disabled. CSP uses per-response script nonces, `strict-dynamic`, same-origin network connections, no frames/objects, and local assets. The style policy permits inline styles for chart dimensions. Development alone permits script eval and WebSocket connections. HTTPS responses add HSTS. Messages render as plain React text; no unsafe HTML, third-party scripts, fonts, tracking, or analytics are included.

### Redis data model

| Key                                | Contents / lifetime                                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `chat:link:{tokenHash}`            | Fake customer details, lifecycle timestamps, status, session-hash reference, blocked/message counts; retained for admin history |
| `chat:link-id:{linkId}`            | Admin-safe link ID to token-hash lookup                                                                                         |
| `chat:customer:{customerId}`       | Latest fictional customer name; session/link records remain authoritative for ownership                                         |
| `chat:binding:{bindingId}`         | Public JWK only; TTL to session absolute expiry + 60 seconds                                                                    |
| `chat:session:{sessionSecretHash}` | Session ID, customer/link/binding references, deadlines/revocation; TTL to absolute expiry + 60 seconds                         |
| `chat:challenge:{nonce}`           | Purpose, subject, binding identity, canonical payload and expiry; TTL 60 seconds; atomically consumed                           |
| `chat:messages:{sessionId}`        | Ordered customer/application message list; expires 24 hours after session absolute deadline                                     |
| `chat:metrics:total`               | Event counters, channel counts, unique opened count                                                                             |
| `chat:metrics:daily:{YYYY-MM-DD}`  | UTC event counters; retained for 90 days                                                                                        |
| `chat:events:recent`               | Bounded to latest 100 events, dashboard shows latest 30; no message content or credentials                                      |
| `chat:links`                       | Sorted creation index for 50-record paginated admin lists                                                                       |
| `chat:pending`                     | Sorted pending-link expiry index                                                                                                |
| `chat:active`                      | Sorted session deadline index                                                                                                   |
| `chat:admin:{hashedId}`            | Revocable admin session, TTL eight hours                                                                                        |
| `chat:rate:*`                      | Short-lived abuse counters                                                                                                      |

No dashboard `SCAN`/`KEYS` is used. It reads counters and sorted-set counts; bounded batches (up to 100 overdue links and 100 sessions per refresh) materialize expiry events. Counts include overdue pending records even before their expiry event batch runs. Session expiry events are emitted when an admin refresh processes the index, rather than by a background worker. Links, safe lookup indexes, fictional customer records, and total counters are retained until the test database is deleted/reset; there is no automatic long-term retention policy for those POC records.

Recorded events: `LINK_CREATED`, `LINK_OPENED`, `LINK_ACTIVATED`, `LINK_EXPIRED`, `LINK_ALREADY_USED`, `LINK_REVOKED`, `ACTIVATION_FAILED`, `SESSION_CREATED`, `SESSION_RESUMED`, `SESSION_EXPIRED`, `DEVICE_PROOF_FAILED`, `CHAT_STARTED`, `MESSAGE_SENT`, `UNAUTHORIZED_ACCESS_BLOCKED`. Opens count measured browser calls, including repeats and bots; unique opens means distinct invitation records, not distinct people. Activation and session creation are lifetime totals; status distribution reflects current link state. Active sessions are nonrevoked sessions before both deadlines. Messages sent counts customer messages, excluding application acknowledgements. Rejected attempts can generate multiple related security signals; these signals are not a count of unique attackers.

### Pages and APIs

| Page           | Access                                                      |
| -------------- | ----------------------------------------------------------- |
| `/admin/login` | Public password form                                        |
| `/admin`       | Server-authorized metrics workspace                         |
| `/admin/links` | Server-authorized creation/list/revocation workspace        |
| `/start#t=...` | Public invitation landing; fragment is scrubbed client-side |
| `/chat`        | Public shell; all customer data requires cookie + proof     |

Route Handlers are grouped in `src/app/api/[...route]/route.ts`:

| Method / API                     | Authorization / purpose                                      |
| -------------------------------- | ------------------------------------------------------------ |
| POST `/api/admin/login`          | Origin, password, rate limit; sets signed cookie             |
| POST `/api/admin/logout`         | Origin + admin auth; invalidates session                     |
| GET/POST `/api/admin/links`      | Admin list (`?offset=0`) / create                            |
| POST `/api/admin/revoke`         | Admin + Origin; `{linkId}` revokes link/session              |
| GET `/api/admin/dashboard`       | Admin-only statistics                                        |
| POST `/api/links/inspect`        | Origin + token; eligibility and measured open, no redemption |
| POST `/api/activation/challenge` | Origin + token + public JWK                                  |
| POST `/api/activation/verify`    | Origin + token + JWK + nonce + signature; atomic activation  |
| POST `/api/session/challenge`    | Origin + session cookie; `{method,path,bodyHash}`            |
| POST `/api/session/resume`       | Origin + cookie + proof headers                              |
| GET `/api/messages`              | Cookie + proof headers                                       |
| POST `/api/messages`             | Origin + cookie + proof headers; `{text}`                    |

Proof headers are `X-Chat-Nonce` and `X-Chat-Proof`. API errors consistently use `{ "error": { "code": "..." } }`; internal exceptions and secret values are not returned. JSON is required for POST bodies, including `{}` for logout/resume. Callers must use the configured exact Origin.

## Automated verification

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm run test:browser
```

For tests, install Redis 7+ (`brew install redis` on macOS; `apt-get install redis-server redis-tools` on Linux). Tests create disposable Redis instances on unique Unix sockets, with persistence disabled. They never flush your Upstash database. If binaries are elsewhere:

```sh
TEST_REDIS_SERVER=/path/to/redis-server TEST_REDIS_CLI=/path/to/redis-cli npm test
```

The service tests use real Web Crypto and execute the actual application Lua against this isolated Redis. They cover one-time activation, a two-browser activation race, used-link rejection, session resume/restart persistence, wrong-key copied cookies, expired/revoked links, replay/concurrent replay, ownership isolation, tampered bodies, expiry, throttling, and exact dashboard metrics. A test-only repository interface supports controlled failure fixtures without a production database fallback.

Browser tests need Google Chrome installed (`npx playwright install chrome` if needed) and a successful production build. They launch the production Next.js server on port 3100 and an authenticated test-only Upstash REST protocol bridge to disposable real Redis on port 8079. The application itself still uses `@upstash/redis`. No real credentials are needed and no `.env` file is written by the harness. Run with the same `TEST_REDIS_*` variables if necessary.

The three Playwright projects cover desktop Chrome, Android Chrome emulation, and an iPhone viewport in Chromium. They exercise admin auth, invitation creation, non-consuming opens, activation, IndexedDB key persistence, chat/refresh, a separate browser, copied cookies, CSRF rejection and revocation. **The iPhone viewport is not a WebKit/Safari engine test.** Real Upstash transport, Vercel, Safari, and SMS/WhatsApp in-app browsers need a manual smoke test with your own credentials/devices. Tracing is disabled to keep raw one-time credentials out of trace archives. Failure screenshots may contain test links and are gitignored.

GitHub Actions is prepared to run these checks on Node 24 with disposable Redis and Chrome. No CI or deployment secrets are embedded.

## Free personal POC deployment

1. Create an Upstash Free Redis database and obtain its REST URL and read/write token as above. Keep it separate from any real/customer database.
2. Create a private GitHub repository and push this source, including `package-lock.json`. Do not include `.env.local`, screenshots with tokens, or customer data. There is no need for a separate backend, storage volume, socket server, or Vercel cron job.
3. In [Vercel](https://vercel.com/), import the GitHub repository as a Next.js project with Node 24 and the default root directory. `vercel.json` sets the framework and build command. Choose the Hobby plan only for personal, non-commercial testing.
4. In **Project → Settings → Environment Variables**, add every `.env.example` variable to Production. Use fresh admin password/signing secret values, the Upstash REST credentials, and an HTTPS `APP_BASE_URL` matching your intended production domain.
5. Deploy. If the final domain was not known beforehand, copy the assigned production origin into `APP_BASE_URL` (for example `https://your-project.vercel.app`) and **redeploy**. Do not use localhost or a different preview domain. Use distinct preview databases/secrets and the preview's exact origin if enabling preview environments.
6. Visit `https://your-project.vercel.app/admin/login`. Generate a new fake-customer invitation. Copy it into an SMS/WhatsApp message to your test phone (manual sending only). Open it over HTTPS, activate, send a message, refresh, and try the original link in a second browser. Revoke it and verify subsequent chat requests fail.
7. Verify events on the admin dashboard and counters in Upstash. Monitor command/storage use. Changing the domain isolates browser credentials; generate new links when moving domains.

Vercel Hobby is restricted to [personal, non-commercial use](https://vercel.com/docs/plans/hobby). A real business/customer pilot needs an appropriate plan and a separate security/privacy review. [Upstash's current Free plan](https://upstash.com/pricing/redis) lists 256 MB storage and 500,000 commands/month; verify pricing and limits before use. Polling, throttling, proof checks, indexes, and Lua subcommands consume quota; an idle open dashboard/chat can consume meaningful resources. Limits, regional latency, cold starts, outages, and free-tier quotas can interrupt this demo; it intentionally denies access when Redis is unavailable. There is no uptime/SLA, customer support workflow, verified first-claim identity, hardware attestation, or production compliance certification here.

## Project layout

```text
src/app/                 App Router pages and grouped Route Handler
src/components/          Admin shell, dashboard, link management and UI
src/lib/browser.ts       IndexedDB credential, signing and proof requests
src/lib/protocol.ts      Shared canonical request encoding
src/lib/models.ts        Typed records
src/lib/server/          Config, auth, crypto, repository, Lua and service
src/proxy.ts             Nonce-based CSP and response security headers
tests/security.test.ts   Real Redis / real ECDSA security suite
tests/redis-fixture.ts   Disposable Redis and test-only REST protocol adapter
tests/browser/           Playwright customer/admin acceptance tests
.env.example             Server environment variable names and defaults
vercel.json              Vercel-compatible Next.js build configuration
```
