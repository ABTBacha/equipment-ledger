import { ArgumentsHost } from '@nestjs/common';
import { z } from 'zod';
import { ZodExceptionFilter } from './zod-exception.filter';

function buildHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;
  return { host, status, json };
}

describe('ZodExceptionFilter', () => {
  it('maps a ZodError to a 400 response carrying the validation error details', () => {
    const schema = z.object({ assetId: z.string().min(1) });
    const parseResult = schema.safeParse({});
    expect(parseResult.success).toBe(false);
    const zodError = (parseResult as { success: false; error: z.ZodError }).error;

    const { host, status, json } = buildHost();
    new ZodExceptionFilter().catch(zodError, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        errors: expect.any(Array),
      }),
    );
  });
});
