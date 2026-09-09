export type MovementType = 'ISSUE' | 'RETURN' | 'OUT_OF_SERVICE' | 'BACK_IN_SERVICE';

export interface MovementView {
  _id: string;
  assetId: string;
  workerId: string | null;
  type: MovementType;
  occurredAt: string;
  recordedAt: string;
  reason: string | null;
}

export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  ISSUE: 'Issue',
  RETURN: 'Return',
  OUT_OF_SERVICE: 'Out of service',
  BACK_IN_SERVICE: 'Back in service',
};

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
  currentlyHolding: import('../components/StoreGrid').AssetSummary[];
}

export type ReservationStatus = 'ACTIVE' | 'CANCELLED' | 'FULFILLED' | 'EXPIRED';

export interface ReservationView {
  _id: string;
  assetId: string;
  workerId: string;
  startAt: string;
  endAt: string;
  status: ReservationStatus;
}

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  ACTIVE: 'Active',
  CANCELLED: 'Cancelled',
  FULFILLED: 'Fulfilled',
  EXPIRED: 'Expired',
};

export interface WorkerDetailView extends WorkerSummaryView {
  reservations: ReservationView[];
}
