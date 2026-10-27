import { jsonResponse } from '@agent-native/adapters/http';
import { pastBestBefore } from '@agent-native/kernel/build';
import type { HostRoute } from './types';

/**
 * GET /api/v1/build: when the running binary was built and its best-before date, for the frame
 * to show. A run from source answers `{}`. Nothing is refused after the date.
 */
export const buildRoute: HostRoute = async (request, url, _session, host) => {
  if (url.pathname !== '/api/v1/build' || request.method !== 'GET') return undefined;
  const { build } = host;
  if (!build) return jsonResponse({});
  return jsonResponse({
    ...build,
    ...(build.bestBefore ? { pastBestBefore: pastBestBefore(build.bestBefore) } : {}),
  });
};
