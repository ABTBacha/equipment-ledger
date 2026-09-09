import { WorkerDetailView, RESERVATION_STATUS_LABEL } from '../../../lib/types';
import { CertificationList } from '../../../components/CertificationList';
import { StoreGrid } from '../../../components/StoreGrid';

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

async function fetchWorker(id: string): Promise<WorkerDetailView> {
  const res = await fetch(`${API_URL}/workers/${id}`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to load worker');
  return res.json();
}

export default async function WorkerDetailPage({ params }: { params: { id: string } }) {
  const worker = await fetchWorker(params.id);
  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1 text-primary">{worker.name}</h1>
      <p className="text-muted mb-6 font-mono">{worker._id}</p>

      <h2 className="text-lg font-semibold mb-2 text-primary">Certifications</h2>
      <CertificationList certifications={worker.certifications} />

      <h2 className="text-lg font-semibold mt-8 mb-2 text-primary">Currently holding</h2>
      <StoreGrid assets={worker.currentlyHolding} />

      <h2 className="text-lg font-semibold mt-8 mb-2 text-primary">Reservations</h2>
      <ul className="space-y-2">
        {worker.reservations.map((r) => (
          <li key={r._id} className="text-sm border border-hairline bg-surface p-3 text-primary">
            <span className="font-mono">{r.assetId}</span>: {new Date(r.startAt).toLocaleString()} –{' '}
            {new Date(r.endAt).toLocaleString()} ({RESERVATION_STATUS_LABEL[r.status]})
          </li>
        ))}
      </ul>
    </main>
  );
}
