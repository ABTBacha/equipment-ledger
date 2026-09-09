import { AssetSummary } from '../../../components/StoreGrid';
import { HistoryEntryView, ReservationView } from '../../../lib/types';
import { AssetDetailClient } from './AssetDetailClient';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchAsset(id: string): Promise<AssetSummary> {
  const res = await fetch(`${API_URL}/assets/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load asset');
  return res.json();
}

async function fetchHistory(id: string): Promise<HistoryEntryView[]> {
  const res = await fetch(`${API_URL}/assets/${id}/history`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load history');
  return res.json();
}

/**
 * There is no per-asset reservations endpoint; the list is small and already served whole, so
 * filter it here rather than widen the API surface for one screen.
 */
async function fetchReservations(assetId: string): Promise<ReservationView[]> {
  const res = await fetch(`${API_URL}/reservations`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load reservations');
  const reservations: ReservationView[] = await res.json();
  return reservations
    .filter((r) => r.assetId === assetId)
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime());
}

export default async function AssetDetailPage({ params }: { params: { id: string } }) {
  const [asset, history, reservations] = await Promise.all([
    fetchAsset(params.id),
    fetchHistory(params.id),
    fetchReservations(params.id),
  ]);
  return <AssetDetailClient asset={asset} history={history} reservations={reservations} />;
}
