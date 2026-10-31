import type { ReactNode } from 'react';
export function Shield({ className = '' }: { className?: string }) {
  return (
    <svg
      className={className}
      width="24"
      height="26"
      viewBox="0 0 24 26"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 2 21 6v7c0 5-5 9-9 11-4-2-9-6-9-11V6l9-4Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="m8 13 3 3 5-6"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function Brand({ dark = false }: { dark?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className="rounded-xl bg-blue-600 p-2 text-white">
        <Shield />
      </div>
      <div className={`text-lg font-bold tracking-tight ${dark ? 'text-white' : 'text-slate-900'}`}>
        SecurLink
        <span className="mt-0.5 block text-[10px] font-medium tracking-[0.18em] text-slate-400 uppercase">
          Secure conversations
        </span>
      </div>
    </div>
  );
}
export function Badge({ value }: { value: string }) {
  const color =
    value === 'ACTIVATED'
      ? 'bg-emerald-50 text-emerald-700'
      : value === 'PENDING'
        ? 'bg-amber-50 text-amber-700'
        : value === 'REVOKED'
          ? 'bg-rose-50 text-rose-700'
          : 'bg-slate-100 text-slate-500';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${color}`}
    >
      <span className="h-1.5 w-1.5 rounded-full bg-current" />
      {value.charAt(0) + value.slice(1).toLowerCase()}
    </span>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <div
      role={error ? 'alert' : 'status'}
      className={`rounded-xl border p-4 text-sm leading-relaxed ${error ? 'border-rose-200 bg-rose-50 text-rose-800' : 'border-blue-100 bg-blue-50 text-blue-800'}`}
    >
      {children}
    </div>
  );
}
export const formatTime = (at?: number) =>
  at
    ? new Date(at).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
