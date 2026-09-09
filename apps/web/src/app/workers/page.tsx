import Link from 'next/link';
import { WorkerSummaryView } from '../../lib/types';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchWorkers(): Promise<WorkerSummaryView[]> {
  const res = await fetch(`${API_URL}/workers`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load workers');
  return res.json();
}

export default async function WorkersPage() {
  const workers = await fetchWorkers();
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Workers</h1>
      <ul className="space-y-2">
        {workers.map((w) => (
          <li key={w._id}>
            <Link href={`/workers/${w._id}`} className="text-blue-600 hover:underline">
              {w.name}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
