export enum MovementType {
  ISSUE = 'ISSUE',
  RETURN = 'RETURN',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
  BACK_IN_SERVICE = 'BACK_IN_SERVICE',
}

export enum AssetStatus {
  IN_STORE = 'IN_STORE',
  ISSUED = 'ISSUED',
  OUT_OF_SERVICE = 'OUT_OF_SERVICE',
}

/**
 * ACTIVE, FULFILLED and CANCELLED are stored. NOT_COLLECTED and OVERDUE are derived at
 * read time and never written: like an overdue asset, they are what the clock makes true
 * about a stored row, and a status a document could drift into with no writer is a status
 * nothing can be trusted to have updated.
 *
 * NOT_COLLECTED replaces the old EXPIRED, which described this exact condition — a booking
 * whose window passed with nobody collecting it — under a name that did not say so.
 */
export enum ReservationStatus {
  ACTIVE = 'ACTIVE',
  CANCELLED = 'CANCELLED',
  FULFILLED = 'FULFILLED',
  NOT_COLLECTED = 'NOT_COLLECTED',
  OVERDUE = 'OVERDUE',
}
