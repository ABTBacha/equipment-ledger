export type AssetStatus = 'IN_STORE' | 'ISSUED' | 'OUT_OF_SERVICE';

const STATUS_LABEL: Record<AssetStatus, string> = {
  IN_STORE: 'In store',
  ISSUED: 'Issued',
  OUT_OF_SERVICE: 'Out of service',
};

const STATUS_COLOR: Record<AssetStatus, string> = {
  IN_STORE: 'var(--accent-green)',
  ISSUED: 'var(--accent-amber)',
  OUT_OF_SERVICE: 'var(--accent-red)',
};

export function StatusIndicator({ status }: { status: AssetStatus }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="inline-block w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: STATUS_COLOR[status] }}
      />
      <span>{STATUS_LABEL[status]}</span>
    </span>
  );
}
