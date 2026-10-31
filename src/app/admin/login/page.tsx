'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Brand, Notice, Shield } from '@/components/ui';
import { post } from '@/lib/browser';
export default function Login() {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <section className="hidden flex-col justify-between bg-[#101e36] p-16 text-white lg:flex">
        <Brand dark />
        <div className="max-w-md">
          <div className="mb-8 inline-flex rounded-2xl border border-blue-400/20 bg-blue-500/10 p-5 text-blue-400">
            <Shield className="h-12 w-12" />
          </div>
          <h1 className="text-5xl leading-tight font-semibold tracking-tight">
            One link.
            <br />
            One browser.
            <br />
            <span className="text-blue-400">A secure conversation.</span>
          </h1>
          <p className="mt-6 max-w-sm text-base leading-7 text-slate-400">
            Create private chat invitations, control access, and understand every step of the link
            lifecycle.
          </p>
        </div>
        <p className="text-xs text-slate-500">SECURLINK / PROOF OF CONCEPT</p>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-12 lg:hidden">
            <Brand />
          </div>
          <p className="eyebrow mb-3 text-blue-600">Admin workspace</p>
          <h2 className="text-3xl font-bold tracking-tight">Welcome back</h2>
          <p className="mt-3 mb-8 leading-6 text-slate-500">
            Sign in to manage your secure customer links.
          </p>
          <form
            className="space-y-5"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError('');
              try {
                await post('/api/admin/login', { password });
                setPassword('');
                router.push('/admin');
                router.refresh();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <div>
              <label className="label" htmlFor="password">
                Admin password
              </label>
              <input
                className="field"
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <Notice error>{error}</Notice>}
            <button className="btn w-full" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in to workspace →'}
            </button>
          </form>
          <p className="mt-8 border-t border-slate-200 pt-6 text-xs leading-6 text-slate-400">
            Protected administrator access. Set your server environment variables before signing in.
            Use fake customer data only.
          </p>
        </div>
      </section>
    </main>
  );
}
