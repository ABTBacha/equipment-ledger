export interface AssetSummary {
  _id: string;
  kind: string;
  requiresCertification: string | null;
  status: 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE';
  currentHolderId: string | null;
  upcomingReservation: { startAt: string; endAt: string; workerId: string } | null;
}

const STATUS_STYLES: Record<string, string> = {
  IN_STORE: 'bg-green-100 text-green-800',
  ISSUED: 'bg-blue-100 text-blue-800',
  OUT_OF_SERVICE: 'bg-red-100 text-red-800',
};

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
        <div key={asset._id} className="border rounded-lg p-4">
          <div className="flex justify-between items-start">
            <div>
              <div className="font-mono text-sm text-gray-500">{asset._id}</div>
              <div className="font-medium">{asset.kind}</div>
            </div>
            <span className={`text-xs px-2 py-1 rounded-full ${STATUS_STYLES[asset.status]}`}>{asset.status}</span>
          </div>
          {asset.currentHolderId && <div className="text-sm text-gray-600 mt-2">Held by {asset.currentHolderId}</div>}
          {(onIssue || onReturn) && (
            <div className="mt-3 flex gap-2">
              {onIssue && asset.status === 'IN_STORE' && (
                <button type="button" onClick={() => onIssue(asset)} className="text-sm px-3 py-1 border rounded">
                  Issue
                </button>
              )}
              {onReturn && asset.status === 'ISSUED' && (
                <button type="button" onClick={() => onReturn(asset)} className="text-sm px-3 py-1 border rounded">
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
