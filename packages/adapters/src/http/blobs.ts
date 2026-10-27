import { ApplicationError, mediaTypePattern } from '@agent-native/contracts';
import type { ExecutionContext } from '@agent-native/runtime';
import type { ApplicationPort } from '../application-port';
import { readBytes } from './body';
import { jsonResponse, secureHeaders } from './response';

const unknownRoute = () => new ApplicationError('NOT_FOUND', 'Unknown route');

/**
 * POST /api/v1/blobs: the body is the blob and `Content-Type` its media type. The body is read
 * only up to the largest size any operation declares; the runtime then checks that an operation
 * this caller may invoke accepts it. Returns 201 with the `BlobRef`.
 */
export async function uploadBlob(
  application: ApplicationPort,
  request: Request,
  context: ExecutionContext,
) {
  if (!application.putBlob) throw unknownRoute();
  const mediaType = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() ?? '';
  if (!mediaTypePattern.test(mediaType))
    throw new ApplicationError('INVALID_INPUT', 'Blob media type required');
  const limit = Math.max(
    0,
    ...application.discover(context).operations.map((operation) => operation.blobs?.maxBytes ?? 0),
  );
  if (limit === 0) throw new ApplicationError('INVALID_INPUT', 'No operation accepts this blob');
  const data = await readBytes(request, limit);
  return jsonResponse(await application.putBlob(data, mediaType, context), 201);
}

/**
 * GET /api/v1/blobs/:digest: a blob the caller may read through a resource that references it.
 * The response is sandboxed and never sniffed, so an uploaded document cannot run script on the
 * instance's origin, and it is not cached, so a revoked reader cannot read it again.
 */
export async function downloadBlob(
  application: ApplicationPort,
  digest: string,
  context: ExecutionContext,
) {
  if (!application.readBlob) throw unknownRoute();
  const { ref, data } = await application.readBlob(digest, context);
  return new Response(data as Uint8Array<ArrayBuffer>, {
    headers: {
      ...secureHeaders,
      'Content-Type': ref.mediaType,
      'Content-Length': String(ref.size),
      'Content-Security-Policy': "sandbox; default-src 'none'",
      'Cross-Origin-Resource-Policy': 'same-origin',
      ETag: `"${ref.digest}"`,
    },
  });
}
