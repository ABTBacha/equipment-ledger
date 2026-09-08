export enum MovementType {
  ISSUE = 'ISSUE',
  RETURN = 'RETURN',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
  BACK_IN_SERVICE = 'BACK_IN_SERVICE',
}

export enum AssetStatus {
  IN_STORE = 'IN_STORE',
  ISSUED = 'ISSUED',
  RESERVED = 'RESERVED',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
}

export enum ReservationStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  FULFILLED = 'FULFILLED',
  EXPIRED = 'EXPIRED',
}
