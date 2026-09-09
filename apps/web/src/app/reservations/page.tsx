import { ReservationsClient } from './ReservationsClient';
import { ReservationView } from '../../lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchReservations(): Promise<ReservationView[]> {
  const res = await fetch(`${API_URL}/reservations`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load reservations');
  return res.json();
}

export default async function ReservationsPage() {
  const reservations = await fetchReservations();
  return <ReservationsClient reservations={reservations} />;
}
