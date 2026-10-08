import type { JsonValue } from './json';

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'IDEMPOTENCY_CONFLICT'
  | 'CANCELLED'
  /** A required dependency of the authority is unavailable, e.g. the audit log in fail-closed mode. */
  | 'UNAVAILABLE'
  | 'INTERNAL';
export class ApplicationError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly details?: JsonValue,
  ) {
    super(message);
    this.name = 'ApplicationError';
  }
}
export interface ErrorEnvelope {
  readonly code: ErrorCode;
  readonly message: string;
  readonly details?: JsonValue;
}
export function errorEnvelope(error: unknown): ErrorEnvelope {
  return error instanceof ApplicationError
    ? {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      }
    : { code: 'INTERNAL', message: 'Application execution failed' };
}
