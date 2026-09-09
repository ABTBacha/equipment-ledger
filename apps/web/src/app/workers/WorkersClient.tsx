'use client';

import Link from 'next/link';
import { WorkerSummaryView } from '../../lib/types';
import { DataTable, DataTableColumn } from '../../components/DataTable';

function CertificationsCell({ worker }: { worker: WorkerSummaryView }) {
  if (worker.certifications.length === 0) return <span className="text-muted">None</span>;
  const now = Date.now();
  return (
    <span className="font-mono text-sm">
      {worker.certifications.map((cert, i) => {
        const expired = new Date(cert.expiresAt).getTime() < now;
        return (
          <span key={cert.code}>
            {i > 0 && <span className="text-muted">, </span>}
            <span className="text-primary">{cert.code}</span>
            {expired && <span className="text-accent-red font-medium"> (Expired)</span>}
          </span>
        );
      })}
    </span>
  );
}

function HoldingCell({ worker }: { worker: WorkerSummaryView }) {
  if (worker.currentlyHolding.length === 0) return <span className="text-muted">—</span>;
  if (worker.currentlyHolding.length <= 3) {
    return (
      <span className="font-mono text-sm text-primary">
        {worker.currentlyHolding.map((a) => a._id).join(', ')}
      </span>
    );
  }
  return (
    <span className="text-primary">
      {worker.currentlyHolding.length} assets
    </span>
  );
}

export function WorkersClient({ workers }: { workers: WorkerSummaryView[] }) {
  const columns: DataTableColumn<WorkerSummaryView>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (w) => (
        <Link href={`/workers/${w._id}`} className="text-accent-blue hover:underline">
          {w.name}
        </Link>
      ),
    },
    { key: 'id', header: 'Worker ID', className: 'font-mono text-muted', render: (w) => w._id },
    { key: 'certifications', header: 'Certifications', render: (w) => <CertificationsCell worker={w} /> },
    { key: 'holding', header: 'Currently holding', render: (w) => <HoldingCell worker={w} /> },
  ];

  return <DataTable columns={columns} rows={workers} rowKey={(w) => w._id} emptyMessage="No workers found." />;
}
