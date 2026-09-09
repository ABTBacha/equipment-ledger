'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AssetSummary } from '../../../components/StoreGrid';
import { HistoryTimeline } from '../../../components/HistoryTimeline';
import { IssueReturnModal } from '../../../components/IssueReturnModal';
import { OutOfServiceControl } from '../../../components/OutOfServiceControl';
import { ReservationList } from '../../../components/ReservationList';
import { StatusIndicator } from '../../../components/StatusIndicator';
import { formatDateTime } from '../../../lib/format';
import { HistoryEntryView, ReservationView } from '../../../lib/types';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted mb-1">{label}</div>
      <div className="text-primary">{children}</div>
    </div>
  );
}

export function AssetDetailClient({
  asset,
  history,
  reservations,
}: {
  asset: AssetSummary;
  history: HistoryEntryView[];
  reservations: ReservationView[];
}) {
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

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 border border-hairline bg-surface p-4 mb-6">
        <Field label="Held by">{asset.currentHolderId ?? 'In store'}</Field>
        <Field label="Certification">{asset.requiresCertification ?? 'None required'}</Field>
        <Field label="Last activity">
          <span className="font-mono text-sm">{formatDateTime(asset.lastActivityAt)}</span>
        </Field>
      </div>

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

      <h2 className="text-lg font-semibold mb-3 text-primary">Reservations</h2>
      <div className="mb-8">
        <ReservationList
          reservations={reservations}
          onChanged={refresh}
          showAsset={false}
          emptyMessage="No reservations for this asset."
        />
      </div>

      <h2 className="text-lg font-semibold mb-3 text-primary">Movement history</h2>
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
