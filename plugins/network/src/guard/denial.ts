import { ApplicationError } from '@agent-native/contracts';

/** Why a connection was refused. Codes are stable and safe to log and display. */
export type DenialReason =
  | 'UNDECLARED'
  | 'NOT_EGRESS'
  | 'DISABLED'
  | 'UNBOUND'
  | 'ORIGIN_MISMATCH'
  | 'ADDRESS_NOT_ALLOWED'
  | 'REDIRECT_NOT_ALLOWED'
  | 'TOO_MANY_REDIRECTS'
  | 'RESPONSE_TOO_LARGE'
  | 'PROCESS_NOT_DECLARED'
  | 'PROCESS_NOT_PERMITTED'
  | 'AUDIT_UNAVAILABLE';
/**
 * A refused connection. It is an `UNAVAILABLE` application error so transports report it as a
 * missing dependency (HTTP 503, CLI exit 8), never as a server fault. The message carries only
 * the destination ID and reason code, which are declared, non-secret names.
 */
export class EgressDenied extends ApplicationError {
  constructor(
    readonly reason: DenialReason,
    readonly destination: string,
  ) {
    super('UNAVAILABLE', `Egress to ${destination} denied: ${reason}`, { destination, reason });
    this.name = 'EgressDenied';
  }
}
