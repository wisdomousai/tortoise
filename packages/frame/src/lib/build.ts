import { useQuery } from '@tanstack/react-query';
import { hostJson } from '@/lib/host-client';

/** What `GET /api/v1/build` answers; empty for a run from source. */
export interface BuildInfo {
  readonly builtAt?: string;
  readonly shelfLifeDays?: number;
  readonly bestBefore?: string;
  readonly pastBestBefore?: boolean;
}

/**
 * The running build's best-before date, read again every hour so an open screen notices the date
 * passing. Undefined until the host answers, and when it cannot be reached.
 */
export function useBuild(): BuildInfo | undefined {
  return useQuery({
    queryKey: ['host', 'build'],
    queryFn: ({ signal }) => hostJson<BuildInfo>('build', undefined, signal),
    refetchInterval: 3_600_000,
    retry: false,
  }).data;
}
