import { WorkerDetailView } from '../../../lib/types';
import { WorkerDetailClient } from './WorkerDetailClient';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchWorker(id: string): Promise<WorkerDetailView> {
  const res = await fetch(`${API_URL}/workers/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load worker');
  return res.json();
}

export default async function WorkerDetailPage({ params }: { params: { id: string } }) {
  const worker = await fetchWorker(params.id);
  return <WorkerDetailClient worker={worker} />;
}
