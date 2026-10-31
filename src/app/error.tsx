'use client';
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-lg p-8 pt-24">
      <h1 className="mb-4 text-2xl font-bold">We couldn’t load this page</h1>
      <p className="mb-6 text-slate-500">
        The service may be unavailable. Please try again shortly.
      </p>
      <button className="btn" onClick={reset}>
        Try again
      </button>
    </main>
  );
}
