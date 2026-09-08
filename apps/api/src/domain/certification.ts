export interface WorkerCertificationInput {
  certifications: { code: string; expiresAt: Date }[];
}

export type CertificationCheckResult = { valid: true } | { valid: false; reason: string };

export function checkCertification(
  worker: WorkerCertificationInput,
  requiredCode: string | null,
  atDate: Date,
): CertificationCheckResult {
  if (requiredCode === null) return { valid: true };

  const cert = worker.certifications.find((c) => c.code === requiredCode);
  if (!cert) {
    return { valid: false, reason: `Worker does not hold the required certification ${requiredCode}` };
  }
  if (cert.expiresAt.getTime() < atDate.getTime()) {
    return {
      valid: false,
      reason: `Certification ${requiredCode} expired ${cert.expiresAt.toISOString().slice(0, 10)}`,
    };
  }
  return { valid: true };
}
