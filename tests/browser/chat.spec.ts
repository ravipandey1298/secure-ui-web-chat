import { test, expect } from '@playwright/test';
test('admin creates link; browser A activates/resumes; browser B and copied cookie cannot access; revoke blocks A', async ({
  page,
  browser,
  baseURL,
}) => {
  const consoleErrors: string[] = [];
  page.on('pageerror', (e) => consoleErrors.push(e.message));
  const publicStats = await page.request.get('/api/admin/dashboard');
  expect(publicStats.status()).toBe(401);
  await page.goto('/admin');
  await expect(page).toHaveURL(/\/admin\/login/);
  await page.getByLabel('Admin password').fill('test-only-admin-password');
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByText('Connecting to Redis…', { exact: true })).not.toBeVisible();
  await page.screenshot({
    path: `test-results/${test.info().project.name}-dashboard.png`,
    fullPage: true,
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('link', { name: 'Create secure link' }).click();
  await page.getByLabel('Test customer ID').fill('TEST-MOBILE');
  await page.getByLabel('Customer name').fill('Alex Demo');
  await page.getByRole('button', { name: 'Generate secure link' }).click();
  const result = page.getByRole('textbox', { name: 'Generated secure link' });
  await expect(result).toBeVisible();
  const invitation = await result.inputValue();
  const contextA = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const a = await contextA.newPage();
  a.on('pageerror', (e) => consoleErrors.push(e.message));
  await a.goto(invitation);
  await expect(a).toHaveURL(`${baseURL}/start`);
  await expect(a.getByRole('button', { name: 'Start Secure Chat' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh', exact: false }).click();
  await expect(page.getByText('Pending', { exact: true })).toBeVisible();
  await a.getByRole('button', { name: 'Start Secure Chat' }).click();
  await expect(a).toHaveURL(/\/chat$/);
  await expect(a.getByLabel('Message', { exact: true })).toBeEnabled();
  await a.getByLabel('Message', { exact: true }).fill('Hello from browser A');
  await a.getByRole('button', { name: 'Send' }).click();
  await expect(a.getByText('Hello from browser A', { exact: true })).toBeVisible();
  await expect(a.getByText('Thanks for your message.', { exact: false })).toBeVisible();
  await a.screenshot({ path: `test-results/${test.info().project.name}-chat.png`, fullPage: true });
  expect(await a.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await a.reload();
  await expect(a.getByText('Hello from browser A', { exact: true })).toBeVisible();
  const keyInfo = await a.evaluate(async () => {
    const request = indexedDB.open('secure-chat-credential', 1);
    return await new Promise<{ extractable: boolean; type: string }>((resolve) => {
      request.onsuccess = () => {
        const db = request.result;
        const get = db.transaction('keys').objectStore('keys').get('browser');
        get.onsuccess = () => {
          resolve({
            extractable: get.result.privateKey.extractable,
            type: get.result.privateKey.type,
          });
          db.close();
        };
      };
    });
  });
  expect(keyInfo).toEqual({ extractable: false, type: 'private' });
  const contextB = await browser.newContext();
  const b = await contextB.newPage();
  await b.goto(invitation);
  await expect(
    b.getByText('This link has already been activated.', { exact: false }),
  ).toBeVisible();
  const token = new URL(invitation).hash.slice(3);
  const blocked = await b.evaluate(async (rawToken) => {
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ]);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    const response = await fetch('/api/activation/challenge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: rawToken,
        publicKey: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
      }),
    });
    return { status: response.status, json: await response.json() };
  }, token);
  expect(blocked.status).toBe(409);
  expect(blocked.json.error.code).toBe('ALREADY_USED');
  await contextB.addCookies((await contextA.cookies()).filter((c) => c.name === 'chat_session'));
  await b.goto('/chat');
  await expect(b.getByText('This browser has no chat key.', { exact: false })).toBeVisible();
  const noProof = await contextB.request.get(`${baseURL}/api/messages`);
  expect(noProof.status()).toBe(403);
  const wrongKeyProofStatus = await b.evaluate(async () => {
    const bodyHash = Array.from(
      new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array())),
    )
      .map((n) => n.toString(16).padStart(2, '0'))
      .join('');
    const c = await (
      await fetch('/api/session/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'GET', path: '/api/messages', bodyHash }),
      })
    ).json();
    const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, [
      'sign',
      'verify',
    ]);
    const bytes = new Uint8Array(
      await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        pair.privateKey,
        new TextEncoder().encode(c.payload),
      ),
    );
    const signature = btoa(String.fromCharCode(...bytes))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');
    return (
      await fetch('/api/messages', {
        headers: { 'X-Chat-Nonce': c.nonce, 'X-Chat-Proof': signature },
      })
    ).status;
  });
  expect(wrongKeyProofStatus).toBe(403);
  // Actual mutations must pass the configured exact-origin CSRF check.
  const csrf = await page.request.post('/api/admin/revoke', {
    data: { linkId: 'x'.repeat(43) },
    headers: { Origin: 'https://attacker.invalid' },
  });
  expect(csrf.status()).toBe(403);
  await page.getByRole('button', { name: 'Refresh', exact: false }).click();
  await expect(page.getByText('Activated', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Revoke', exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Revoked', exact: true }).first()).toBeDisabled();
  await a.reload();
  await expect(a.getByRole('alert')).toBeVisible();
  await expect(a.getByLabel('Message', { exact: true })).toBeDisabled();
  await page.getByRole('link', { name: 'Overview', exact: false }).click();
  await expect(page.getByRole('heading', { name: 'Recent security events' })).toBeVisible();
  expect(consoleErrors).toEqual([]);
  await contextA.close();
  await contextB.close();
});
