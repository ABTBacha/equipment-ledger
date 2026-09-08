import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import { ZodError } from 'zod';

/**
 * Maps a ZodError escaping a controller's `.parse(body)` call to a 400 Bad Request
 * instead of Nest's default 500, with the validation issue details in the body.
 * Registered globally in main.ts so no individual controller needs its own try/catch.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<{ status: (code: number) => { json: (body: unknown) => unknown } }>();
    response.status(400).json({
      statusCode: 400,
      message: 'Validation failed',
      errors: exception.errors,
    });
  }
}
