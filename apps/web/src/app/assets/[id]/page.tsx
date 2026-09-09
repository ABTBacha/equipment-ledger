import { AssetSummary } from '../../../components/StoreGrid';
import { HistoryEntryView } from '../../../lib/types';
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

export default async function AssetDetailPage({ params }: { params: { id: string } }) {
  const [asset, history] = await Promise.all([fetchAsset(params.id), fetchHistory(params.id)]);
  return <AssetDetailClient asset={asset} history={history} />;
}
