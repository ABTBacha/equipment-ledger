import { DashboardClient } from './DashboardClient';
import { AssetSummary } from '../components/StoreGrid';

async function fetchAssets(): Promise<AssetSummary[]> {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
  const res = await fetch(`${apiUrl}/assets`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load assets');
  return res.json();
}

export default async function HomePage() {
  const assets = await fetchAssets();
  return <DashboardClient assets={assets} />;
}
