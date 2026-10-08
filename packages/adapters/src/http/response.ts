export const secureHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};
export const statusCodes = {
  INVALID_INPUT: 400,
  INVALID_OUTPUT: 500,
  NOT_FOUND: 404,
  FORBIDDEN: 403,
  CONFLICT: 409,
  IDEMPOTENCY_CONFLICT: 409,
  CANCELLED: 409,
  UNAVAILABLE: 503,
  INTERNAL: 500,
};
export function jsonResponse(value: unknown, status = 200, headers: HeadersInit = {}): Response {
  return Response.json(value, { status, headers: { ...secureHeaders, ...headers } });
}
