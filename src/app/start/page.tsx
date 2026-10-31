'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand, Notice, Shield } from '@/components/ui';
import { ClientError, credential, friendly, post, protectedRequest, sign } from '@/lib/browser';
import type { Challenge } from '@/lib/models';
export default function Start() {
  const token = useRef('');
  const initialized = useRef(false);
  const [status, setStatus] = useState('LOADING');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [canResume, setCanResume] = useState(false);
  const router = useRouter();
  const inspect = async () => {
    setError('');
    if (token.current) {
      try {
        const data = await post<{ status: string }>('/api/links/inspect', { token: token.current });
        setStatus(data.status);
      } catch (e) {
        setStatus('ERROR');
        setError((e as Error).message);
      }
    } else setStatus('NO_TOKEN');
    try {
      await protectedRequest('/api/session/resume', 'POST', {});
      setCanResume(true);
    } catch (e) {
      if (
        !token.current &&
        e instanceof ClientError &&
        !['SESSION_REQUIRED', 'KEY_MISSING'].includes(e.code)
      )
        setError(e.message);
    }
  };
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const fragment = new URLSearchParams(location.hash.slice(1));
    token.current = fragment.get('t') ?? '';
    // Capture in memory and scrub synchronously, before any network operation.
    history.replaceState(null, '', location.pathname);
    void inspect();
    // The invitation stays exclusively in this component's in-memory ref.
  }, []);
  const activate = async () => {
    setBusy(true);
    setError('');
    try {
      const key = await credential(true);
      const challenge = await post<Challenge>('/api/activation/challenge', {
        token: token.current,
        publicKey: key.publicKey,
      });
      const signature = await sign(key.privateKey, challenge.payload);
      await post('/api/activation/verify', {
        token: token.current,
        publicKey: key.publicKey,
        nonce: challenge.nonce,
        signature,
      });
      token.current = '';
      router.replace('/chat');
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ClientError && ['ALREADY_USED', 'EXPIRED', 'REVOKED'].includes(e.code))
        setStatus(e.code);
      // A committed activation can outlive a lost response; prove the cookie/key if present.
      try {
        await protectedRequest('/api/session/resume', 'POST', {});
        setCanResume(true);
      } catch {
        /* The original error stays visible. */
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="flex min-h-dvh flex-col items-center bg-[radial-gradient(ellipse_at_top,#e9f0ff,transparent_60%)] px-5 py-8">
      <div className="mb-12">
        <Brand />
      </div>
      <section className="card w-full max-w-md p-7 text-center sm:p-10">
        <div className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-3xl border border-blue-100 bg-blue-50 text-blue-600">
          <Shield className="h-10 w-10" />
        </div>
        <p className="eyebrow mb-3 text-blue-600">A private space to connect</p>
        <h1 className="text-3xl font-bold tracking-tight">
          Welcome to your
          <br />
          secure conversation
        </h1>
        <p className="mt-4 mb-7 text-sm leading-7 text-slate-500">
          No password. No sign-up. Activate your invitation to start chatting in this browser.
        </p>
        <div className="space-y-4 text-left">
          {status === 'LOADING' && (
            <p role="status" className="text-center text-slate-400">
              Checking your invitation…
            </p>
          )}
          {error && <Notice error>{error}</Notice>}
          {['EXPIRED', 'REVOKED', 'ACTIVATED', 'ALREADY_USED'].includes(status) && !error && (
            <Notice>{friendly(status === 'ACTIVATED' ? 'ALREADY_USED' : status)}</Notice>
          )}
          {status === 'NO_TOKEN' && !canResume && (
            <Notice>
              Open the complete secure link sent to you. If you refreshed before activation, reopen
              the original invitation.
            </Notice>
          )}
          {status === 'PENDING' && (
            <button className="btn w-full" onClick={() => void activate()} disabled={busy}>
              {busy ? 'Securing your browser…' : 'Start Secure Chat →'}
            </button>
          )}
          {canResume && (
            <button className="btn w-full" onClick={() => router.replace('/chat')}>
              Continue existing chat →
            </button>
          )}
          {status === 'ERROR' && (
            <button className="btn-secondary w-full" onClick={() => void inspect()}>
              Try again
            </button>
          )}
        </div>
        <div className="mt-8 space-y-3 border-t border-slate-100 pt-6 text-left text-xs text-slate-500">
          <p>
            <span className="mr-2 text-emerald-600">✓</span> Your browser creates and stores a
            private key
          </p>
          <p>
            <span className="mr-2 text-emerald-600">✓</span> Only this browser can continue after
            activation
          </p>
          <p>
            <span className="mr-2 text-emerald-600">✓</span> The sender can revoke access at any
            time
          </p>
        </div>
      </section>
      <p className="mt-7 max-w-sm text-center text-[11px] leading-6 text-slate-400">
        Use the same browser to return to your conversation. Private browsing or clearing browser
        data may remove your access. Demo only — do not share sensitive information.
      </p>
      <p className="mt-8 text-[10px] tracking-[0.15em] text-slate-400 uppercase">
        SecurLink · Browser-bound chat
      </p>
    </main>
  );
}
