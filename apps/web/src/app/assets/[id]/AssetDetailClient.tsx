'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AssetSummary } from '../../../components/StoreGrid';
import { HistoryTimeline } from '../../../components/HistoryTimeline';
import { IssueReturnModal } from '../../../components/IssueReturnModal';
import { OutOfServiceControl } from '../../../components/OutOfServiceControl';
import { StatusIndicator } from '../../../components/StatusIndicator';
import { HistoryEntryView } from '../../../lib/types';

export function AssetDetailClient({ asset, history }: { asset: AssetSummary; history: HistoryEntryView[] }) {
  const router = useRouter();
  const [modalAction, setModalAction] = useState<'issue' | 'return' | null>(null);

  const refresh = () => router.refresh();

  return (
    <main className="p-8 max-w-3xl mx-auto">
      <h1 className="text-2xl font-semibold mb-1 font-mono text-primary">{asset._id}</h1>
      <p className="text-muted mb-6 flex items-center gap-2">
        <span>{asset.kind}</span>
        <span>—</span>
        <StatusIndicator status={asset.status} />
      </p>
      <div className="flex gap-2 mb-8">
        {asset.status === 'IN_STORE' && (
          <button
            type="button"
            onClick={() => setModalAction('issue')}
            className="px-3 py-1 border border-hairline text-primary hover:bg-raised"
          >
            Issue
          </button>
        )}
        {asset.status === 'ISSUED' && (
          <button
            type="button"
            onClick={() => setModalAction('return')}
            className="px-3 py-1 border border-hairline text-primary hover:bg-raised"
          >
            Return
          </button>
        )}
        <OutOfServiceControl assetId={asset._id} status={asset.status} onDone={refresh} />
      </div>
      <h2 className="text-lg font-semibold mb-3 text-primary">History</h2>
      <HistoryTimeline entries={history} onCorrected={refresh} />
      {modalAction && (
        <IssueReturnModal
          asset={asset}
          action={modalAction}
          onClose={() => {
            setModalAction(null);
            refresh();
          }}
        />
      )}
    </main>
  );
}
