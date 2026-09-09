'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AssetSummary } from '../components/StoreGrid';
import { IssueReturnModal } from '../components/IssueReturnModal';
import { OutOfServiceControl } from '../components/OutOfServiceControl';
import { DataTable, DataTableColumn } from '../components/DataTable';
import { StatusIndicator } from '../components/StatusIndicator';
import { formatDateTime } from '../lib/format';

export function DashboardClient({ assets }: { assets: AssetSummary[] }) {
  const router = useRouter();
  const [kindFilter, setKindFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<{ asset: AssetSummary; action: 'issue' | 'return' } | null>(null);

  const kinds = useMemo(() => Array.from(new Set(assets.map((a) => a.kind))), [assets]);

  const filtered = useMemo(
    () =>
      assets.filter((a) => {
        if (kindFilter && a.kind !== kindFilter) return false;
        if (statusFilter && a.status !== statusFilter) return false;
        if (search && !a._id.toLowerCase().includes(search.toLowerCase())) return false;
        return true;
      }),
    [assets, kindFilter, statusFilter, search],
  );

  const closeModal = () => {
    setModal(null);
    router.refresh();
  };

  const columns: DataTableColumn<AssetSummary>[] = [
    {
      key: 'code',
      header: 'Code',
      render: (a) => (
        <Link href={`/assets/${a._id}`} className="font-mono text-primary hover:underline">
          {a._id}
        </Link>
      ),
    },
    { key: 'kind', header: 'Kind', render: (a) => a.kind },
    { key: 'status', header: 'Status', render: (a) => <StatusIndicator status={a.status} /> },
    { key: 'holder', header: 'Holder', render: (a) => a.currentHolderId ?? '—' },
    { key: 'cert', header: 'Cert required', render: (a) => a.requiresCertification ?? '—' },
    {
      key: 'reservation',
      header: 'Upcoming reservation',
      render: (a) =>
        a.upcomingReservation
          ? `${a.upcomingReservation.workerId}, ${formatDateTime(a.upcomingReservation.startAt)}`
          : '—',
    },
    {
      key: 'activity',
      header: 'Last activity',
      render: (a) => <span className="font-mono text-muted">{formatDateTime(a.lastActivityAt)}</span>,
    },
  ];

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Equipment Ledger</h1>
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-hairline bg-surface px-3 py-2 text-primary placeholder:text-muted"
        />
        <select
          value={kindFilter}
          onChange={(e) => setKindFilter(e.target.value)}
          className="border border-hairline bg-surface px-3 py-2 text-primary"
        >
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Status filter"
          className="border border-hairline bg-surface px-3 py-2 text-primary"
        >
          <option value="">All statuses</option>
          <option value="IN_STORE">In store</option>
          <option value="ISSUED">Issued</option>
          <option value="OUT_OF_SERVICE">Out of service</option>
        </select>
      </div>
      <DataTable
        columns={columns}
        rows={filtered}
        rowKey={(a) => a._id}
        actions={(asset) => (
          <div className="flex gap-2">
            {asset.status === 'IN_STORE' && (
              <button
                type="button"
                onClick={() => setModal({ asset, action: 'issue' })}
                className="text-sm px-2 py-1 border border-hairline text-primary hover:bg-raised"
              >
                Issue
              </button>
            )}
            {asset.status === 'ISSUED' && (
              <button
                type="button"
                onClick={() => setModal({ asset, action: 'return' })}
                className="text-sm px-2 py-1 border border-hairline text-primary hover:bg-raised"
              >
                Return
              </button>
            )}
            <OutOfServiceControl assetId={asset._id} status={asset.status} onDone={() => router.refresh()} />
          </div>
        )}
      />
      {modal && <IssueReturnModal asset={modal.asset} action={modal.action} onClose={closeModal} />}
    </main>
  );
}
