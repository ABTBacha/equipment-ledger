'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutGrid, Users, CalendarClock, History } from 'lucide-react';
import { useEffect, useState } from 'react';
import { getCurrentKeeper } from '../lib/api';

const KEEPER_STORAGE_KEY = 'equipment-ledger:keeper';

const NAV_ITEMS = [
  { href: '/', label: 'Dashboard', icon: LayoutGrid },
  { href: '/workers', label: 'Workers', icon: Users },
  { href: '/reservations', label: 'Reservations', icon: CalendarClock },
  { href: '/history', label: 'History', icon: History },
];

export function Sidebar() {
  const pathname = usePathname();
  const [keeper, setKeeper] = useState<string | null>(null);

  useEffect(() => {
    setKeeper(getCurrentKeeper());
  }, []);

  const switchKeeper = () => {
    try {
      window.localStorage.removeItem(KEEPER_STORAGE_KEY);
    } catch {
      // Storage may be unavailable (private browsing); reload still resets KeeperGate's state.
    }
    window.location.reload();
  };

  return (
    <aside className="w-[220px] shrink-0 bg-raised border-r border-hairline flex flex-col h-screen sticky top-0">
      <div className="px-4 py-5 border-b border-hairline">
        <span className="text-sm font-semibold tracking-tight text-primary">Equipment Ledger</span>
      </div>
      <nav className="flex-1 px-2 py-4 flex flex-col gap-1">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = href === '/' ? pathname === '/' : pathname?.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-2 px-3 py-2 rounded text-sm transition-colors ${
                active ? 'bg-surface text-primary' : 'text-muted hover:bg-surface hover:text-primary'
              }`}
            >
              <Icon size={16} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="px-4 py-4 border-t border-hairline">
        <div className="text-xs text-muted">On the hatch</div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm text-primary truncate">{keeper ?? '—'}</div>
          <button
            type="button"
            onClick={switchKeeper}
            className="text-xs text-accent-blue hover:underline shrink-0"
          >
            Switch
          </button>
        </div>
      </div>
    </aside>
  );
}
