'use client';
import { useCallback, useEffect, useState } from 'react';
import type { ChatLink } from '@/lib/models';
import { api, post } from '@/lib/browser';
import { Badge, Notice, formatTime } from './ui';
type ListedLink = Omit<ChatLink, 'tokenHash' | 'sessionHash'>;
export function Links({ defaultExpiry }: { defaultExpiry: number }) {
  const [links, setLinks] = useState<ListedLink[]>([]);
  const [offset, setOffset] = useState(0);
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revoking, setRevoking] = useState('');
  const load = useCallback(async () => {
    try {
      const data = await api<{ links: ListedLink[] }>(`/api/admin/links?offset=${offset}`);
      setLinks(data.links);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [offset]);
  useEffect(() => {
    const initial = setTimeout(() => void load(), 0);
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 15000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);
  return (
    <div className="space-y-7">
      <div>
        <p className="eyebrow mb-2">Invite. Activate. Connect.</p>
        <h1 className="text-3xl font-bold tracking-tight">Customer links</h1>
        <p className="mt-2 text-slate-500">
          Create a private invitation and share it through your preferred channel.
        </p>
      </div>
      {error && <Notice error>{error}</Notice>}
      <section className="card overflow-hidden">
        <div className="border-b border-slate-100 px-6 py-5">
          <h2 className="font-bold">Create a secure link</h2>
          <p className="mt-1 text-xs text-slate-400">
            For demonstration only. Enter fictional customer information.
          </p>
        </div>
        <form
          className="p-6"
          onSubmit={async (e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            setBusy(true);
            setError('');
            setUrl('');
            setCopied(false);
            try {
              const data = await post<{ url: string }>('/api/admin/links', {
                customerId: form.get('customerId'),
                customerName: form.get('customerName'),
                channel: form.get('channel'),
                expiryMinutes: Number(form.get('expiryMinutes')),
              });
              setUrl(data.url);
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
            <div>
              <label className="label" htmlFor="customerId">
                Test customer ID
              </label>
              <input
                className="field"
                id="customerId"
                name="customerId"
                placeholder="e.g. TEST-001"
                maxLength={64}
                pattern="[a-zA-Z0-9_-]+"
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="customerName">
                Customer name <span className="font-normal text-slate-400">(fake data)</span>
              </label>
              <input
                className="field"
                id="customerName"
                name="customerName"
                placeholder="e.g. Alex Morgan"
                maxLength={80}
                required
              />
            </div>
            <div>
              <label className="label" htmlFor="channel">
                Delivery channel
              </label>
              <select className="field" id="channel" name="channel">
                <option value="SMS">SMS</option>
                <option value="WHATSAPP">WhatsApp</option>
              </select>
            </div>
            <div>
              <label className="label" htmlFor="expiry">
                Expires after (minutes)
              </label>
              <input
                className="field"
                id="expiry"
                name="expiryMinutes"
                type="number"
                min={1}
                max={10080}
                defaultValue={defaultExpiry}
                required
              />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-4">
            <span className="text-xs text-slate-400">
              256-bit random token · One-time activation · Browser-bound access
            </span>
            <button className="btn" disabled={busy}>
              {busy ? 'Generating…' : 'Generate secure link →'}
            </button>
          </div>
        </form>
        {url && (
          <div className="mx-6 mb-6 space-y-4 rounded-xl border border-emerald-200 bg-emerald-50/60 p-5">
            <p className="font-semibold text-emerald-800">Your secure link is ready</p>
            <div className="flex flex-wrap gap-3">
              <input
                className="field min-w-0 flex-1 text-xs"
                aria-label="Generated secure link"
                value={url}
                readOnly
                onFocus={(e) => e.target.select()}
              />
              <button
                className="btn-secondary"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(url);
                    setCopied(true);
                  } catch {
                    setError('Copy is unavailable. Select the link and copy it manually.');
                  }
                }}
              >
                {copied ? 'Copied ✓' : 'Copy link'}
              </button>
              <a className="btn" href={url} target="_blank" rel="noreferrer">
                Open link ↗
              </a>
            </div>
            <p className="text-xs leading-5 text-emerald-900/70">
              This complete token is displayed only at creation. It cannot be recovered from the
              database. Copy it before leaving this page; anyone with an unused link can activate
              it.
            </p>
          </div>
        )}
      </section>
      <section className="card overflow-hidden">
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-5">
          <div>
            <h2 className="font-bold">All customer links</h2>
            <p className="mt-1 text-xs text-slate-400">
              Most recent first · Updates every 15 seconds
            </p>
          </div>
          <button className="btn-secondary" onClick={() => void load()}>
            Refresh ↻
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] tracking-wide text-slate-400 uppercase">
              <tr>
                {[
                  'Customer',
                  'Channel',
                  'Status',
                  'Created',
                  'Expires',
                  'First opened',
                  'Activated',
                  'Blocked',
                  'Messages',
                  'Action',
                ].map((x) => (
                  <th key={x} className="px-4 py-4 font-semibold">
                    {x}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {links.map((link) => (
                <tr key={link.id} className="border-t border-slate-100">
                  <td className="px-4 py-5">
                    <strong className="block font-semibold">{link.customerName}</strong>
                    <span className="mt-1 block text-[10px] text-slate-400">{link.customerId}</span>
                  </td>
                  <td className="px-4 py-4 text-slate-500">
                    {link.channel === 'SMS' ? 'SMS' : 'WhatsApp'}
                  </td>
                  <td className="px-4 py-4">
                    <Badge value={link.status} />
                  </td>
                  {[link.createdAt, link.expiresAt, link.openedAt, link.activatedAt].map(
                    (at, i) => (
                      <td key={i} className="px-4 py-4 whitespace-nowrap text-slate-500">
                        {formatTime(at)}
                      </td>
                    ),
                  )}
                  <td className="px-4 py-4">{link.blockedAttempts}</td>
                  <td className="px-4 py-4">{link.messageCount}</td>
                  <td className="px-4 py-4">
                    <button
                      className="min-h-11 font-semibold text-rose-600 disabled:text-slate-300"
                      disabled={link.status === 'REVOKED' || revoking === link.id}
                      onClick={async () => {
                        setRevoking(link.id);
                        try {
                          await post('/api/admin/revoke', { linkId: link.id });
                          await load();
                        } catch (e) {
                          setError((e as Error).message);
                        } finally {
                          setRevoking('');
                        }
                      }}
                    >
                      {link.status === 'REVOKED'
                        ? 'Revoked'
                        : revoking === link.id
                          ? 'Revoking…'
                          : 'Revoke'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!links.length && (
            <div className="px-6 py-16 text-center">
              <p className="font-semibold text-slate-600">
                {loading ? 'Loading customer links…' : 'No links on this page yet'}
              </p>
              <p className="mt-2 text-xs text-slate-400">
                Generate your first invitation with the form above.
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 px-6 py-4 text-xs text-slate-400">
          <span>Page {offset / 50 + 1} · Up to 50 links per page</span>
          <div className="flex gap-3">
            <button
              className="btn-secondary"
              disabled={offset === 0}
              onClick={() => {
                setLoading(true);
                setOffset((x) => Math.max(0, x - 50));
              }}
            >
              Previous
            </button>
            <button
              className="btn-secondary"
              disabled={links.length < 50}
              onClick={() => {
                setLoading(true);
                setOffset((x) => x + 50);
              }}
            >
              Next
            </button>
          </div>
        </div>
      </section>
      <p className="text-xs text-slate-400">
        Revoking an invitation immediately blocks its active chat session. Invitation expiry applies
        before activation; activated chats follow their own session timeout.
      </p>
    </div>
  );
}
