'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Brand, Notice, Shield } from './ui';
import { post } from '@/lib/browser';
export function AdminShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const [error, setError] = useState('');
  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="flex flex-col bg-[#101e36] px-5 py-6 lg:fixed lg:inset-y-0 lg:left-0 lg:w-64">
        <div className="px-2">
          <Brand dark />
        </div>
        <p className="eyebrow mt-10 hidden px-3 text-slate-500 lg:block">Workspace</p>
        <nav className="mt-5 flex gap-2 lg:flex-col">
          {[
            ['/admin', 'Overview', '◫'],
            ['/admin/links', 'Customer links', '↗'],
          ].map(([href, text, icon]) => (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 rounded-lg px-3 py-3 font-medium ${path === href ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
            >
              <span className="text-lg">{icon}</span>
              {text}
            </Link>
          ))}
        </nav>
        <div className="mt-auto hidden pt-12 lg:block">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 text-xs leading-6 text-slate-400">
            <Shield className="mb-3 text-blue-400" />
            <strong className="block text-slate-200">Proof of concept</strong>Use fictional customer
            details only. This workspace is for testing.
          </div>
          <div className="mt-6 flex items-center gap-3 border-t border-white/10 px-2 pt-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-slate-700 text-xs text-white">
              AD
            </div>
            <div className="text-sm text-white">
              Administrator<span className="block text-xs text-slate-500">Secure workspace</span>
            </div>
          </div>
        </div>
      </aside>
      <header className="flex min-h-20 items-center justify-between border-b border-slate-200 bg-white px-5 md:px-10">
        <div className="text-sm text-slate-400">
          Workspace <span className="mx-3">/</span>
          <span className="font-medium text-slate-700">
            {path === '/admin' ? 'Overview' : 'Customer links'}
          </span>
        </div>
        <button
          className="text-sm font-medium text-slate-500 hover:text-blue-600"
          onClick={async () => {
            try {
              await post('/api/admin/logout', {});
              router.push('/admin/login');
              router.refresh();
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Sign out ↗
        </button>
      </header>
      <main className="mx-auto max-w-[1500px] p-5 md:p-10">
        {error && <Notice error>{error}</Notice>}
        {children}
      </main>
    </div>
  );
}
