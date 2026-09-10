'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { AssetSummary } from '../../components/StoreGrid';
import { DataTable, DataTableColumn } from '../../components/DataTable';
import { StatusIndicator } from '../../components/StatusIndicator';

interface StoreResponse {
  asOf: string;
  assets: Record<
    string,
    {
      status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE';
      holderId: string | null;
      dueAt: string | null;
      isOverdue: boolean;
    }
  >;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

export function HistoryClient() {
  const [assetMeta, setAssetMeta] = useState<AssetSummary[]>([]);
  const [asOfInput, setAsOfInput] = useState('');
  const [snapshot, setSnapshot] = useState<AssetSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<AssetSummary[]>('/assets')
      .then(setAssetMeta)
      .catch((err) => {
        setError(err instanceof Error ? err.message : 'Something went wrong');
        setLoading(false);
      });
  }, []);

  const loadAsOf = async (meta: AssetSummary[], asOfIso?: string) => {
    setLoading(true);
    try {
      const query = asOfIso ? `?asOf=${encodeURIComponent(asOfIso)}` : '';
      const response = await apiFetch<StoreResponse>(`/store${query}`);
      setSnapshot(
        meta.map((m) => {
          const state = response.assets[m._id];
          return {
            ...m,
            status: state?.status ?? 'IN_STORE',
            currentHolderId: state?.holderId ?? null,
            // Unlike the two fields below, these ARE historical: the replay carries the
            // due-back time of the issue that was open at that instant, and the API compares
            // it against that same instant rather than against now.
            dueAt: state?.dueAt ?? null,
            isOverdue: state?.isOverdue ?? false,
            // Historical reconstruction only covers status/holder (from /store?asOf=).
            // upcomingReservation and lastActivityAt are always the CURRENT values on the
            // /assets response, so they must never be shown on a past "as of" snapshot.
            upcomingReservation: null,
            lastActivityAt: null,
          };
        }),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (assetMeta.length > 0) loadAsOf(assetMeta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetMeta]);

  const handleTimestampChange = (value: string) => {
    setAsOfInput(value);
    if (value) loadAsOf(assetMeta, new Date(value).toISOString());
  };

  const handleNow = () => {
    setAsOfInput('');
    loadAsOf(assetMeta);
  };

  const columns: DataTableColumn<AssetSummary>[] = [
    { key: 'code', header: 'Code', render: (a) => <span className="font-mono text-primary">{a._id}</span> },
    { key: 'kind', header: 'Kind', render: (a) => a.kind },
    { key: 'status', header: 'Status', render: (a) => <StatusIndicator status={a.status} /> },
    { key: 'holder', header: 'Holder', render: (a) => a.currentHolderId ?? '—' },
    {
      key: 'due',
      header: 'Due back',
      render: (a) =>
        a.dueAt ? (
          <span className={a.isOverdue ? 'font-mono text-accent-red' : 'font-mono text-muted'}>
            {formatDateTime(a.dueAt)}
            {a.isOverdue && <span className="ml-2">Overdue</span>}
          </span>
        ) : (
          '—'
        ),
    },
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
      <h1 className="text-2xl font-semibold mb-6">Store history</h1>
      <div className="flex items-center gap-3 mb-6">
        <input
          type="datetime-local"
          aria-label="As of"
          value={asOfInput}
          onChange={(e) => handleTimestampChange(e.target.value)}
          className="border border-hairline bg-surface px-3 py-2 text-primary"
        />
        <button type="button" onClick={handleNow} className="px-3 py-1 border border-hairline text-primary hover:bg-raised">
          Now
        </button>
      </div>
      {error && <div className="text-sm text-accent-red mb-3">{error}</div>}
      <DataTable columns={columns} rows={snapshot} rowKey={(a) => a._id} loading={loading && snapshot.length === 0} />
    </main>
  );
}
