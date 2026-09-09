import Link from 'next/link';
import './globals.css';
import { KeeperGate } from '../components/KeeperGate';

export const metadata = { title: 'Equipment Ledger' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <KeeperGate>
          <nav className="border-b px-4 py-3 flex gap-4 text-sm">
            <Link href="/" className="text-blue-600 hover:underline">
              Dashboard
            </Link>
            <Link href="/workers" className="text-blue-600 hover:underline">
              Workers
            </Link>
            <Link href="/reservations" className="text-blue-600 hover:underline">
              Reservations
            </Link>
            <Link href="/history" className="text-blue-600 hover:underline">
              History
            </Link>
          </nav>
          {children}
        </KeeperGate>
      </body>
    </html>
  );
}
