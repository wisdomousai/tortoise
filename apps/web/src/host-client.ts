/** Small host-only API client; provider responses contain safe metadata, never tokens. */
export async function hostJson<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  const result = await response.json();
  if (!response.ok)
    throw new Error(
      (result as { error?: { message?: string } }).error?.message ?? 'Host operation failed',
    );
  return result as T;
}
