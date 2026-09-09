'use client';

import { useRouter } from 'next/navigation';
import { CertificationEditor } from '../../../components/CertificationEditor';
import { ReservationList } from '../../../components/ReservationList';
import { StoreGrid } from '../../../components/StoreGrid';
import { WorkerDetailView } from '../../../lib/types';

export function WorkerDetailClient({ worker }: { worker: WorkerDetailView }) {
  const router = useRouter();
  const refresh = () => router.refresh();

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1 text-primary">{worker.name}</h1>
      <p className="text-muted mb-6 font-mono">{worker._id}</p>

      <h2 className="text-lg font-semibold mb-2 text-primary">Certifications</h2>
      <CertificationEditor workerId={worker._id} certifications={worker.certifications} onChanged={refresh} />

      <h2 className="text-lg font-semibold mt-8 mb-2 text-primary">Currently holding</h2>
      {worker.currentlyHolding.length === 0 ? (
        <p className="text-sm text-muted">Holding nothing right now.</p>
      ) : (
        <StoreGrid assets={worker.currentlyHolding} />
      )}

      <h2 className="text-lg font-semibold mt-8 mb-2 text-primary">Reservations</h2>
      <ReservationList
        reservations={worker.reservations}
        onChanged={refresh}
        showAsset
        emptyMessage="No reservations."
      />
    </main>
  );
}
