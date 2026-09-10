import { z } from 'zod';

/**
 * Below this much time before the next reservation starts, an issue that would have to fit
 * in the gap is refused outright rather than handed out with a due date minutes away.
 * Never applied to a worker collecting their own booking.
 */
export const MIN_LOAN_BEFORE_RESERVATION_MS = 30 * 60 * 1000;

export const IssueMovementSchema = z.object({
  assetId: z.string().min(1),
  workerId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  // When the asset is due back. Required: overdue is only answerable if every loan says
  // when it ends. An issue that collects a reservation must carry that booking's end time,
  // and the API refuses any other value rather than silently overriding it.
  dueAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
  loggedBy: z.string().min(1).optional(),
});
export type IssueMovementDto = z.infer<typeof IssueMovementSchema>;

export const ReturnMovementSchema = z.object({
  assetId: z.string().min(1),
  workerId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
  outOfService: z.boolean().optional(),
  loggedBy: z.string().min(1).optional(),
});
export type ReturnMovementDto = z.infer<typeof ReturnMovementSchema>;

export const CorrectMovementSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  dueAt: z.string().datetime().optional(),
  reason: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  loggedBy: z.string().min(1).optional(),
}).refine((data) => data.occurredAt !== undefined || data.dueAt !== undefined || data.reason !== undefined, {
  message: 'At least one of occurredAt, dueAt or reason must be provided',
});
export type CorrectMovementDto = z.infer<typeof CorrectMovementSchema>;

export const CreateReservationSchema = z.object({
  assetId: z.string().min(1),
  workerId: z.string().min(1),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  idempotencyKey: z.string().min(1),
}).refine((data) => new Date(data.endAt).getTime() > new Date(data.startAt).getTime(), {
  message: 'endAt must be after startAt',
  path: ['endAt'],
});
export type CreateReservationDto = z.infer<typeof CreateReservationSchema>;

export const UpsertCertificationSchema = z.object({
  code: z.string().min(1),
  expiresAt: z.string().datetime(),
});
export type UpsertCertificationDto = z.infer<typeof UpsertCertificationSchema>;

export const CancelReservationSchema = z.object({
  reason: z.string().min(1).optional(),
  loggedBy: z.string().min(1).optional(),
});
export type CancelReservationDto = z.infer<typeof CancelReservationSchema>;

export const TakeOutOfServiceSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  reason: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
  loggedBy: z.string().min(1).optional(),
});
export type TakeOutOfServiceDto = z.infer<typeof TakeOutOfServiceSchema>;

export const BringBackIntoServiceSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
  loggedBy: z.string().min(1).optional(),
});
export type BringBackIntoServiceDto = z.infer<typeof BringBackIntoServiceSchema>;
