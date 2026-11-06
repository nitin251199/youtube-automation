import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'YouTube Automation',
  description: 'Turn a finished Hindi folk-horror script into a reviewed, uploaded YouTube video.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden>▶</span>
            <span>YouTube Automation</span>
          </Link>
          <nav><Link href="/">New video</Link></nav>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
