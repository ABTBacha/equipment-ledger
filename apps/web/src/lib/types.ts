export interface MovementView {
  _id: string;
  assetId: string;
  workerId: string | null;
  type: 'ISSUE' | 'RETURN' | 'OUT_OF_SERVICE' | 'BACK_IN_SERVICE';
  occurredAt: string;
  recordedAt: string;
  reason: string | null;
}

export interface HistoryEntryView {
  movement: MovementView;
  correction: MovementView | null;
}

export interface CertificationView {
  code: string;
  expiresAt: string;
}

export interface WorkerSummaryView {
  _id: string;
  name: string;
  certifications: CertificationView[];
}

export interface ReservationView {
  _id: string;
  assetId: string;
  workerId: string;
  startAt: string;
  endAt: string;
  status: 'ACTIVE' | 'CANCELLED' | 'FULFILLED' | 'EXPIRED';
}

export interface WorkerDetailView extends WorkerSummaryView {
  currentlyHolding: import('../components/StoreGrid').AssetSummary[];
  reservations: ReservationView[];
}
