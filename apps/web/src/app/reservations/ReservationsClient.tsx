'use client';

import { useRouter } from 'next/navigation';
import { ReservationForm } from '../../components/ReservationForm';
import { ReservationList } from '../../components/ReservationList';
import { ReservationView } from '../../lib/types';

export function ReservationsClient({ reservations }: { reservations: ReservationView[] }) {
  const router = useRouter();
  const refresh = () => router.refresh();
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6 text-primary">Reservations</h1>
      <ReservationForm onCreated={refresh} />
      <ReservationList reservations={reservations} onChanged={refresh} />
    </main>
  );
}
