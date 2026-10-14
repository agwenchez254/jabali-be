import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { FieldError, ProblemDetails } from './models';

const TITLES: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  409: 'Conflict',
  413: 'Payload Too Large',
  415: 'Unsupported Media Type',
  422: 'Unprocessable Entity',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

/** Thrown by services for domain errors that carry a machine-readable code. */
export class DomainError extends HttpException {
  constructor(
    status: HttpStatus,
    public readonly code: string,
    message: string,
    public readonly extra?: Record<string, unknown>,
  ) {
    super({ code, message, ...extra }, status);
  }
}

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly log = new Logger('Http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    const problem = this.toProblem(exception, req);
    if (problem.status >= 500) this.log.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, req: Request): ProblemDetails {
    const instance = req.originalUrl;
    const base = (status: number, detail?: string, extra: Partial<ProblemDetails> = {}): ProblemDetails => ({
      type: 'about:blank',
      title: TITLES[status] ?? 'Error',
      status,
      detail,
      instance,
      ...extra,
    });

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') return base(status, body);
      const b = body as { message?: string | string[]; code?: string; errors?: FieldError[]; [k: string]: unknown };
      const { message, code, errors, error: _e, statusCode: _s, ...rest } = b;
      void _e;
      void _s;
      const detail = Array.isArray(message) ? message.join('; ') : message;
      // RFC 7807 allows extension members at the top level (e.g. `shortages`)
      return { ...base(status, detail, { code, errors }), ...rest };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          const target = (exception.meta?.target as string[] | string | undefined) ?? 'field';
          return base(409, `A record with this ${Array.isArray(target) ? target.join(', ') : target} already exists`, {
            code: 'unique_violation',
          });
        }
        case 'P2025':
          return base(404, 'Record not found', { code: 'not_found' });
        case 'P2003':
          return base(409, 'Operation conflicts with related records', { code: 'foreign_key_violation' });
        case 'P2023':
          return base(400, 'Malformed identifier', { code: 'invalid_id' });
        default:
          break;
      }
    }
    return base(HttpStatus.INTERNAL_SERVER_ERROR, 'Unexpected error');
  }
}
