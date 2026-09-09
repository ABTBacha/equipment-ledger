'use client';

import { useEffect, useState } from 'react';
import { KEEPERS } from '../lib/keepers';

const STORAGE_KEY = 'equipment-ledger:keeper';

export function KeeperGate({ children }: { children: React.ReactNode }) {
  const [keeper, setKeeper] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      setKeeper(window.localStorage.getItem(STORAGE_KEY));
    } catch {
      setKeeper(null);
    }
    setHydrated(true);
  }, []);

  const selectKeeper = (name: string) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, name);
    } catch {
      // Storage may be unavailable (private browsing); the session still gates via component state.
    }
    setKeeper(name);
  };

  if (!hydrated) return null;

  if (!keeper) {
    return (
      <div className="min-h-screen bg-base text-primary flex items-center justify-center">
        <div className="p-8 max-w-md w-full mx-auto">
          <h1 className="text-xl font-semibold mb-4">Who&apos;s on the hatch?</h1>
          <ul className="space-y-2">
            {KEEPERS.map((name) => (
              <li key={name}>
                <button
                  type="button"
                  className="w-full text-left px-4 py-2 border border-hairline bg-surface hover:bg-raised text-primary"
                  onClick={() => selectKeeper(name)}
                >
                  {name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
