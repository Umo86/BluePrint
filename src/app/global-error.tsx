'use client';

/** Last-resort error page when the root layout itself fails. Plain HTML, no app styles. */
export default function GlobalError({ error, retry }: { error: unknown; retry: () => void }) {
  const digest = error instanceof Error && 'digest' in error ? String((error as Error & { digest?: string }).digest ?? '') : '';
  return (
    <html lang="en-GB">
      <body style={{ fontFamily: 'system-ui, sans-serif', background: '#f8f9fa', margin: 0 }}>
        <main style={{ maxWidth: 480, margin: '15vh auto', padding: 24, background: '#fff', border: '1px solid #dee2e6', borderRadius: 8 }}>
          <title>Something went wrong · BluePrint</title>
          <h1 style={{ fontSize: 22, marginTop: 0 }}>Something went wrong</h1>
          <p style={{ color: '#495057' }}>Sorry, BluePrint couldn’t load this page. Please try again in a moment.</p>
          {digest ? <p style={{ color: '#868e96', fontSize: 12 }}>Reference: {digest}</p> : null}
          <button type="button" onClick={() => retry()} style={{ padding: '8px 16px', borderRadius: 6, border: 0, background: '#2e52af', color: '#fff', cursor: 'pointer' }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
