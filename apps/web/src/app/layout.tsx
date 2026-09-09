import './globals.css';
import { KeeperGate } from '../components/KeeperGate';

export const metadata = { title: 'Equipment Ledger' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <KeeperGate>{children}</KeeperGate>
      </body>
    </html>
  );
}
