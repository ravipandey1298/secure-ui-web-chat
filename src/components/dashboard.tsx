'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { Dashboard as DashboardData } from '@/lib/models';
import { api, ClientError } from '@/lib/browser';
import { useRouter } from 'next/navigation';
import { Badge, Notice, formatTime } from './ui';
const metricDefinitions = [
  ['Links generated', 'LINK_CREATED', '↗', 'All invitations created'],
  ['Link open events', 'LINK_OPENED', '◉', 'Measured browser events'],
  ['Activated links', 'LINK_ACTIVATED', '✓', 'Successfully bound to a browser'],
  ['Active sessions', 'active', '◷', 'Within the session timeout'],
];
export function Dashboard() {
  const [data, setData] = useState<DashboardData>();
  const [error, setError] = useState('');
  const [updated, setUpdated] = useState('');
  const router = useRouter();
  useEffect(() => {
    let disposed = false;
    const load = async () => {
      try {
        const next = await api<DashboardData>('/api/admin/dashboard');
        if (!disposed) {
          setData(next);
          setError('');
          setUpdated(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        }
      } catch (e) {
        if (e instanceof ClientError && e.code === 'ADMIN_REQUIRED') router.replace('/admin/login');
        else if (!disposed) setError((e as Error).message);
      }
    };
    void load();
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [router]);
  const totals = data?.totals ?? {};
  const value = (key: string) => (data ? Number(totals[key] ?? 0).toLocaleString() : '—');
  const blocked = (totals.ACTIVATION_FAILED ?? 0) + (totals.LINK_ALREADY_USED ?? 0);
  const days = data?.daily ?? [];
  const maxActivity = Math.max(
    5,
    ...days.map((d) =>
      Math.max(
        d.counts.LINK_CREATED ?? 0,
        d.counts.LINK_ACTIVATED ?? 0,
        d.counts.MESSAGE_SENT ?? 0,
      ),
    ),
  );
  const totalLinks = Number(totals.LINK_CREATED ?? 0);
  const colors = {
    ACTIVATED: '#2563eb',
    PENDING: '#fbbf24',
    EXPIRED: '#cbd5e1',
    REVOKED: '#fb7185',
  };
  const distribution = Object.entries(
    data?.distribution ?? { ACTIVATED: 0, PENDING: 0, EXPIRED: 0, REVOKED: 0 },
  );
  let cumulative = 0;
  const gradient = distribution
    .map(([status, count]) => {
      const start = cumulative;
      cumulative += totalLinks ? (count / totalLinks) * 100 : 0;
      return `${colors[status as keyof typeof colors]} ${start}% ${cumulative}%`;
    })
    .join(', ');
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-center justify-between gap-5">
        <div>
          <p className="eyebrow mb-2">Your workspace at a glance</p>
          <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
          <p className="mt-2 text-slate-500">
            Every invitation. Every conversation. All in one place.
          </p>
        </div>
        <Link href="/admin/links" className="btn">
          <span className="text-lg font-normal">+</span> Create secure link
        </Link>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
        <span className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${error ? 'bg-rose-500' : 'bg-emerald-500'}`}
          />
          {error ? 'Connection interrupted' : 'Live workspace'}{' '}
          <span className="ml-2 border-l border-slate-200 pl-3">Refreshes every 15 seconds</span>
        </span>
        <span>{updated ? `Last synced at ${updated}` : 'Connecting to Redis…'}</span>
      </div>
      {error && <Notice error>{error}</Notice>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metricDefinitions.map(([label, key, icon, hint]) => (
          <div key={key} className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-slate-500">{label}</h2>
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-50 text-lg text-blue-600">
                {icon}
              </span>
            </div>
            <div className="mt-4 text-3xl font-bold tracking-tight">
              {key === 'active' ? (data?.activeSessions.toLocaleString() ?? '—') : value(key)}
            </div>
            <p className="mt-2 text-xs text-slate-400">{hint}</p>
          </div>
        ))}
      </div>
      <div className="card grid grid-cols-2 divide-slate-100 sm:grid-cols-3 xl:grid-cols-6">
        {[
          ['Unique links opened', value('UNIQUE_OPENED')],
          ['Pending links', data?.distribution.PENDING ?? '—'],
          ['Expired links', data?.distribution.EXPIRED ?? '—'],
          ['Blocked activations', data ? blocked : '—'],
          ['Sessions started', value('SESSION_CREATED')],
          ['Messages sent', value('MESSAGE_SENT')],
        ].map(([label, count]) => (
          <div className="border-r border-b border-slate-100 px-5 py-5 last:border-r-0" key={label}>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-2 text-xl font-semibold">{count}</p>
          </div>
        ))}
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <section className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-bold">Activity over time</h2>
              <p className="mt-1 text-xs text-slate-400">Daily counts · last 7 days · UTC</p>
            </div>
            <span className="rounded-md border border-slate-200 px-3 py-1.5 text-xs text-slate-500">
              Last 7 days
            </span>
          </div>
          <div className="mt-6 flex gap-5 text-[11px] text-slate-500">
            {[
              ['bg-blue-600', 'Created'],
              ['bg-sky-300', 'Activated'],
              ['bg-emerald-300', 'Messages'],
            ].map(([c, l]) => (
              <span key={l} className="flex items-center gap-1.5">
                <i className={`h-2 w-2 rounded-sm ${c}`} />
                {l}
              </span>
            ))}
          </div>
          <div className="mt-7 flex h-44 items-end justify-around gap-3 border-b border-slate-200 bg-[repeating-linear-gradient(to_top,transparent_0,transparent_42px,#f1f5f9_43px,#f1f5f9_44px)]">
            {days.map((day) => (
              <div
                key={day.date}
                className="flex h-full flex-1 items-end justify-center gap-1"
                aria-label={`${day.date}: ${day.counts.LINK_CREATED ?? 0} created, ${day.counts.LINK_ACTIVATED ?? 0} activated, ${day.counts.MESSAGE_SENT ?? 0} messages`}
              >
                {[
                  ['LINK_CREATED', 'bg-blue-600'],
                  ['LINK_ACTIVATED', 'bg-sky-300'],
                  ['MESSAGE_SENT', 'bg-emerald-300'],
                ].map(([key, cls]) => (
                  <div
                    key={key}
                    title={`${key}: ${day.counts[key] ?? 0}`}
                    className={`w-3 rounded-t-sm sm:w-4 ${cls}`}
                    style={{
                      height: `${Math.max(1, ((day.counts[key] ?? 0) / maxActivity) * 100)}%`,
                    }}
                  />
                ))}
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-around text-[10px] text-slate-400">
            {days.map((day) => (
              <span key={day.date}>
                {new Date(day.date + 'T00:00:00Z').toLocaleDateString(undefined, {
                  weekday: 'short',
                  timeZone: 'UTC',
                })}
              </span>
            ))}
          </div>
          {data && totalLinks === 0 && (
            <p className="mt-4 text-xs text-slate-400">
              Create your first link to start measuring activity.
            </p>
          )}
        </section>
        <section className="card p-6">
          <h2 className="font-bold">Link status</h2>
          <p className="mt-1 text-xs text-slate-400">Current invitation lifecycle</p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-8">
            <div
              className="flex h-36 w-36 items-center justify-center rounded-full"
              style={{ background: totalLinks ? `conic-gradient(${gradient})` : '#e2e8f0' }}
            >
              <div className="flex h-28 w-28 flex-col items-center justify-center rounded-full bg-white">
                <strong className="text-3xl tracking-tight">{value('LINK_CREATED')}</strong>
                <span className="mt-1 text-xs text-slate-400">total links</span>
              </div>
            </div>
            <div className="min-w-30 space-y-4">
              {distribution.map(([s, n]) => (
                <div key={s} className="flex items-center gap-2 text-xs">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: colors[s as keyof typeof colors] }}
                  />
                  <span className="flex-1 text-slate-500">
                    {s.charAt(0) + s.slice(1).toLowerCase()}
                  </span>
                  <strong className="ml-3">{data ? n : '—'}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>
      <div className="grid gap-5 xl:grid-cols-[1.65fr_1fr]">
        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
            <div>
              <h2 className="font-bold">Recent security events</h2>
              <p className="mt-1 text-xs text-slate-400">Latest activity across your workspace</p>
            </div>
            <span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-500">
              LIVE FEED
            </span>
          </div>
          <div className="max-h-80 overflow-y-auto">
            {data?.events.length ? (
              data.events.map((event, i) => (
                <div
                  key={`${event.at}-${i}`}
                  className="flex items-center gap-3 border-b border-slate-50 px-6 py-4"
                >
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${/FAILED|BLOCKED|USED|REVOKED/.test(event.type) ? 'bg-amber-50 text-amber-600' : 'bg-blue-50 text-blue-600'}`}
                  >
                    {/FAILED|BLOCKED|USED/.test(event.type) ? '!' : '↗'}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">
                      {event.type
                        .replaceAll('_', ' ')
                        .toLowerCase()
                        .replace(/^./, (c) => c.toUpperCase())}
                    </p>
                    <p className="mt-1 truncate text-[11px] text-slate-400">
                      {event.linkId ? `Link ${event.linkId.slice(0, 10)}…` : 'Workspace event'}
                    </p>
                  </div>
                  <time className="text-right text-[10px] text-slate-400">
                    {formatTime(event.at)}
                  </time>
                </div>
              ))
            ) : (
              <div className="px-6 py-14 text-center text-sm text-slate-400">
                {data
                  ? 'Security events will appear here as you test links.'
                  : 'Loading security events…'}
              </div>
            )}
          </div>
        </section>
        <div className="space-y-5">
          <section className="card p-6">
            <h2 className="font-bold">Invitation channels</h2>
            <p className="mt-1 text-xs text-slate-400">Generated links by intended channel</p>
            <div className="mt-6 space-y-5">
              {[
                ['SMS', 'Text message', 'bg-blue-500'],
                ['WHATSAPP', 'WhatsApp', 'bg-emerald-400'],
              ].map(([key, label, c]) => (
                <div key={key}>
                  <div className="mb-2 flex justify-between text-xs">
                    <span className="font-medium text-slate-600">{label}</span>
                    <span className="text-slate-400">{value(`CHANNEL_${key}`)} links</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className={`h-full rounded-full ${c}`}
                      style={{
                        width: `${totalLinks ? ((totals[`CHANNEL_${key}`] ?? 0) / totalLinks) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>
          <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-5">
            <h2 className="text-sm font-bold text-blue-900">Secure from the first activation</h2>
            <p className="mt-2 text-xs leading-6 text-blue-800/70">
              Links bind to the first browser that activates them. An unused link can be claimed by
              anyone who possesses it.
            </p>
            <div className="mt-3">
              <Badge value="ACTIVATED" />
              <span className="ml-2 text-[11px] text-blue-700">
                Browser key required for every message
              </span>
            </div>
          </div>
        </div>
      </div>
      <p className="text-[11px] leading-5 text-slate-400">
        Open events are measured browser events, including repeated and automated visits. They are
        not verified human views. Customer message counts exclude automatic acknowledgements.
      </p>
    </div>
  );
}
