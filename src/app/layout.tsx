import type { Metadata } from 'next';
import { headers } from 'next/headers';
import './globals.css';
export const metadata: Metadata = {
  title: 'SecurLink · Secure Chat POC',
  description: 'One-time chat links with cryptographic browser binding.',
  robots: { index: false, follow: false },
};
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await headers(); // Dynamic rendering lets Next.js apply the per-request CSP nonce.
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
