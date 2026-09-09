'use client';

import { useRouter } from 'next/navigation';
import { ReservationForm } from '../../components/ReservationForm';
import { ReservationView } from '../../lib/types';

export function ReservationsClient({ reservations }: { reservations: ReservationView[] }) {
  const router = useRouter();
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6 text-primary">Reservations</h1>
      <ReservationForm onCreated={() => router.refresh()} />
      <ul className="space-y-2">
        {reservations.map((r) => (
          <li key={r._id} className="text-sm border border-hairline bg-surface p-3 text-primary">
            <span className="font-mono">{r.assetId}</span> — {r.workerId}: {new Date(r.startAt).toLocaleString()} –{' '}
            {new Date(r.endAt).toLocaleString()} ({r.status})
          </li>
        ))}
      </ul>
    </main>
  );
}
