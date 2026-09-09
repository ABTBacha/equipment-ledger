import { WorkerSummaryView } from '../../lib/types';
import { WorkersClient } from './WorkersClient';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchWorkers(): Promise<WorkerSummaryView[]> {
  const res = await fetch(`${API_URL}/workers`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load workers');
  return res.json();
}

export default async function WorkersPage() {
  const workers = await fetchWorkers();
  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6 text-primary">Workers</h1>
      <WorkersClient workers={workers} />
    </main>
  );
}
