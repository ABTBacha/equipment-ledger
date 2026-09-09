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
