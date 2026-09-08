import { checkCertification } from './certification';

describe('checkCertification', () => {
  const worker = {
    certifications: [{ code: 'GAS-DETECT', expiresAt: new Date('2026-09-01T00:00:00.000Z') }],
  };

  it('passes when no certification is required', () => {
    expect(checkCertification(worker, null, new Date('2026-09-10'))).toEqual({ valid: true });
  });

  it('passes when the worker holds a non-expired certification', () => {
    const result = checkCertification(worker, 'GAS-DETECT', new Date('2026-08-01'));
    expect(result.valid).toBe(true);
  });

  it('fails when the certification expired before the check date', () => {
    const result = checkCertification(worker, 'GAS-DETECT', new Date('2026-09-02'));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/expired/i);
  });

  it('fails when the worker does not hold the required certification at all', () => {
    const result = checkCertification(worker, 'HEIGHTS', new Date('2026-08-01'));
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.reason).toMatch(/does not hold/i);
  });

  it('treats the exact expiry instant as still valid (expiresAt >= atDate passes)', () => {
    const result = checkCertification(worker, 'GAS-DETECT', new Date('2026-09-01T00:00:00.000Z'));
    expect(result.valid).toBe(true);
  });

  it('fails one millisecond after the exact expiry instant', () => {
    const result = checkCertification(worker, 'GAS-DETECT', new Date('2026-09-01T00:00:00.001Z'));
    expect(result.valid).toBe(false);
  });
});
