import Link from 'next/link';
import { StatusIndicator } from './StatusIndicator';
import { formatDateTime } from '../lib/format';

export interface AssetSummary {
  _id: string;
  kind: string;
  requiresCertification: string | null;
  status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE';
  currentHolderId: string | null;
  upcomingReservation: { startAt: string; endAt: string; workerId: string } | null;
  lastActivityAt: string | null;
  /** When the current holder is due to bring it back; null unless it is out on an issue that named a time. */
  dueAt: string | null;
  isOverdue: boolean;
}

export function StoreGrid({
  assets,
  onIssue,
  onReturn,
}: {
  assets: AssetSummary[];
  onIssue?: (asset: AssetSummary) => void;
  onReturn?: (asset: AssetSummary) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {assets.map((asset) => (
        <div key={asset._id} className="border border-hairline bg-surface p-4">
          <div className="flex justify-between items-start">
            <Link href={`/assets/${asset._id}`} className="hover:underline">
              <div className="font-mono text-sm text-muted">{asset._id}</div>
              <div className="font-medium text-primary">{asset.kind}</div>
            </Link>
            <StatusIndicator status={asset.status} />
          </div>
          {asset.currentHolderId && <div className="text-sm text-muted mt-2">Held by {asset.currentHolderId}</div>}
          {asset.dueAt && (
            <div className={`text-sm mt-1 ${asset.isOverdue ? 'text-accent-red' : 'text-muted'}`}>
              {asset.isOverdue ? 'Overdue since' : 'Due back'} {formatDateTime(asset.dueAt)}
            </div>
          )}
          {(onIssue || onReturn) && (
            <div className="mt-3 flex gap-2">
              {onIssue && asset.status === 'IN_STORE' && (
                <button
                  type="button"
                  onClick={() => onIssue(asset)}
                  className="text-sm px-3 py-1 border border-hairline text-primary hover:bg-raised"
                >
                  Issue
                </button>
              )}
              {onReturn && asset.status === 'ISSUED' && (
                <button
                  type="button"
                  onClick={() => onReturn(asset)}
                  className="text-sm px-3 py-1 border border-hairline text-primary hover:bg-raised"
                >
                  Return
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
