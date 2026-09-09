'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '../../lib/api';
import { AssetSummary, StoreGrid } from '../../components/StoreGrid';

interface AssetMeta {
  _id: string;
  kind: string;
  requiresCertification: string | null;
}

interface StoreResponse {
  asOf: string;
  assets: Record<string, { status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE'; holderId: string | null }>;
}

export function HistoryClient() {
  const [assetMeta, setAssetMeta] = useState<AssetMeta[]>([]);
  const [asOfInput, setAsOfInput] = useState('');
  const [snapshot, setSnapshot] = useState<AssetSummary[]>([]);

  useEffect(() => {
    apiFetch<AssetMeta[]>('/assets').then(setAssetMeta);
  }, []);

  const loadAsOf = async (meta: AssetMeta[], asOfIso?: string) => {
    const query = asOfIso ? `?asOf=${encodeURIComponent(asOfIso)}` : '';
    const response = await apiFetch<StoreResponse>(`/store${query}`);
    setSnapshot(
      meta.map((m) => {
        const state = response.assets[m._id];
        return {
          _id: m._id,
          kind: m.kind,
          requiresCertification: m.requiresCertification,
          status: state?.status ?? 'IN_STORE',
          currentHolderId: state?.holderId ?? null,
          upcomingReservation: null,
        };
      }),
    );
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

  return (
    <main className="p-8 max-w-6xl mx-auto">
      <h1 className="text-2xl font-semibold mb-6">Store history</h1>
      <div className="flex items-center gap-3 mb-6">
        <input
          type="datetime-local"
          aria-label="As of"
          value={asOfInput}
          onChange={(e) => handleTimestampChange(e.target.value)}
          className="border rounded px-3 py-2"
        />
        <button type="button" onClick={handleNow} className="px-3 py-1 border rounded">
          Now
        </button>
      </div>
      <StoreGrid assets={snapshot} />
    </main>
  );
}
