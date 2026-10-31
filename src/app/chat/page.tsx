'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Brand, Notice, Shield } from '@/components/ui';
import type { Message } from '@/lib/models';
import { ClientError, protectedRequest } from '@/lib/browser';
export default function Chat() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [denied, setDenied] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const load = useCallback(async (resume = false) => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const result = await protectedRequest(
        resume ? '/api/session/resume' : '/api/messages',
        resume ? 'POST' : 'GET',
        resume ? {} : undefined,
      );
      setMessages(result.messages);
      setError('');
      setDenied(false);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ClientError && /SESSION|KEY_MISSING|PROOF/.test(e.code)) setDenied(true);
    } finally {
      setLoading(false);
      inFlight.current = false;
    }
  }, []);
  useEffect(() => {
    const initial = setTimeout(() => void load(true), 0);
    const timer = setInterval(() => {
      if (!document.hidden) void load();
    }, 10000);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [load]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: 'instant' });
  }, [messages.length]);
  return (
    <main className="mx-auto flex h-dvh max-w-3xl flex-col border-slate-200 bg-white sm:border-x">
      <header className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-5">
        <Brand />
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-semibold text-emerald-700">
          <Shield className="h-3 w-3" /> Browser-bound
        </span>
      </header>
      <div className="shrink-0 border-b border-blue-100 bg-blue-50 px-5 py-3 text-center text-[11px] leading-5 text-blue-800">
        Private conversation · Demo environment · Use fictional information only
      </div>
      <section
        className="flex-1 overflow-y-auto bg-[#f8faff] p-5 sm:p-8"
        aria-label="Chat messages"
        aria-live="polite"
      >
        {loading ? (
          <p className="pt-12 text-center text-slate-400">Verifying your browser…</p>
        ) : (
          <>
            <div className="mx-auto mb-8 max-w-xs text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-100 bg-white text-blue-600">
                <Shield />
              </div>
              <h1 className="text-lg font-bold">Your secure chat</h1>
              <p className="mt-2 text-xs leading-6 text-slate-400">
                Messages are saved for this session. Each request is verified with your browser’s
                private key.
              </p>
            </div>
            {!denied && (
              <div className="mb-5 max-w-[85%] rounded-2xl rounded-bl-sm border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-600">
                Welcome! Send a message to try your secure chat. You’ll receive an automatic
                acknowledgement.
              </div>
            )}
            {!denied &&
              messages.map((message) => (
                <div
                  key={message.id}
                  className={`mb-4 flex ${message.role === 'customer' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-2xl px-4 py-3 ${message.role === 'customer' ? 'rounded-br-sm bg-blue-600 text-white' : 'rounded-bl-sm border border-slate-200 bg-white text-slate-600'}`}
                  >
                    <p className="mb-1 text-[10px] font-semibold opacity-60">
                      {message.role === 'customer' ? 'You' : 'SecurLink · automatic reply'}
                    </p>
                    <p className="text-sm leading-6 whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {message.text}
                    </p>
                    <time className="mt-2 block text-right text-[10px] opacity-60">
                      {new Date(message.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                </div>
              ))}
            <div ref={bottom} />
          </>
        )}
        {error && (
          <div className="my-4 space-y-3">
            <Notice error>{error}</Notice>
            {denied ? (
              <Link href="/start" className="btn-secondary">
                Return to invitation
              </Link>
            ) : (
              <button className="btn-secondary" onClick={() => void load(true)}>
                Retry connection
              </button>
            )}
          </div>
        )}
      </section>
      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))]">
        <form
          className="flex items-end gap-3"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!text.trim() || inFlight.current) return;
            inFlight.current = true;
            setSending(true);
            setError('');
            try {
              const result = await protectedRequest('/api/messages', 'POST', { text: text.trim() });
              setMessages(result.messages);
              setText('');
            } catch (e) {
              setError((e as Error).message);
              if (e instanceof ClientError && /SESSION|KEY_MISSING|PROOF/.test(e.code))
                setDenied(true);
            } finally {
              inFlight.current = false;
              setSending(false);
            }
          }}
        >
          <label htmlFor="message" className="sr-only">
            Message
          </label>
          <textarea
            className="field max-h-32 min-h-12 flex-1 resize-none bg-slate-50"
            id="message"
            rows={1}
            maxLength={2000}
            placeholder="Type your message…"
            value={text}
            disabled={loading || denied || sending}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="btn h-12 px-5" disabled={loading || denied || sending || !text.trim()}>
            {sending ? '…' : 'Send ↑'}
          </button>
        </form>
        <p className="mt-3 text-center text-[10px] text-slate-400">
          Secure transport · Private key stays in your browser · Automatic demo replies
        </p>
      </footer>
    </main>
  );
}
