import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';
import { KeeperGate } from '../components/KeeperGate';
import { Sidebar } from '../components/Sidebar';
import { ToastProvider } from '../components/ToastProvider';

export const metadata = { title: 'Equipment Ledger' };

const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-plex-sans',
  display: 'swap',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-plex-mono',
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <body className="bg-base text-primary">
        <ToastProvider>
          <KeeperGate>
            <div className="flex min-h-screen">
              <Sidebar />
              <div className="flex-1 min-w-0">{children}</div>
            </div>
          </KeeperGate>
        </ToastProvider>
      </body>
    </html>
  );
}
