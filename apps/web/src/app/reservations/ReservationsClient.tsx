'use client';

import { useRouter } from 'next/navigation';
import { ReservationForm } from '../../components/ReservationForm';
import { ReservationView } from '../../lib/types';

export function ReservationsClient({ reservations }: { reservations: ReservationView[] }) {
  const router = useRouter();
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Reservations</h1>
      <ReservationForm onCreated={() => router.refresh()} />
      <ul className="space-y-2">
        {reservations.map((r) => (
          <li key={r._id} className="text-sm border rounded p-3">
            {r.assetId} — {r.workerId}: {new Date(r.startAt).toLocaleString()} – {new Date(r.endAt).toLocaleString()} ({r.status})
          </li>
        ))}
      </ul>
    </main>
  );
}
