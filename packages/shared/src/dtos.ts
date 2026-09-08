import { z } from 'zod';

export const IssueMovementSchema = z.object({
  assetId: z.string().min(1),
  workerId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
  reservationId: z.string().min(1).optional(),
});
export type IssueMovementDto = z.infer<typeof IssueMovementSchema>;

export const ReturnMovementSchema = z.object({
  assetId: z.string().min(1),
  workerId: z.string().min(1),
  occurredAt: z.string().datetime().optional(),
  idempotencyKey: z.string().min(1),
  outOfService: z.boolean().optional(),
});
export type ReturnMovementDto = z.infer<typeof ReturnMovementSchema>;

export const CorrectMovementSchema = z.object({
  occurredAt: z.string().datetime().optional(),
  reason: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1),
}).refine((data) => data.occurredAt !== undefined || data.reason !== undefined, {
  message: 'At least one of occurredAt or reason must be provided',
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
