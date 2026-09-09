'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AssetSummary, StoreGrid } from '../components/StoreGrid';
import { IssueReturnModal } from '../components/IssueReturnModal';

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

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Equipment Ledger</h1>
      <div className="flex gap-3 mb-6">
        <input
          type="text"
          placeholder="Search by code"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border rounded px-3 py-2"
        />
        <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className="border rounded px-3 py-2">
          <option value="">All kinds</option>
          {kinds.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border rounded px-3 py-2">
          <option value="">All statuses</option>
          <option value="IN_STORE">In store</option>
          <option value="ISSUED">Issued</option>
          <option value="OUT_OF_SERVICE">Out of service</option>
        </select>
      </div>
      <StoreGrid
        assets={filtered}
        onIssue={(asset) => setModal({ asset, action: 'issue' })}
        onReturn={(asset) => setModal({ asset, action: 'return' })}
      />
      {modal && <IssueReturnModal asset={modal.asset} action={modal.action} onClose={closeModal} />}
    </main>
  );
}
