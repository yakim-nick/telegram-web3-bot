/** One careful way to call an external HTTP API: timeout, size cap, JSON only. */

export class UpstreamError extends Error {
  constructor(
    message: string,
    readonly cause_?: unknown,
  ) {
    super(message);
    this.name = 'UpstreamError';
  }
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

const MAX_BODY_BYTES = 1_000_000;

export async function fetchJson(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  label: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const timedOut =
      error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
    throw new UpstreamError(`${label}: ${timedOut ? 'request timed out' : 'network error'}`, error);
  }
  if (!response.ok) throw new UpstreamError(`${label}: HTTP ${response.status}`);

  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) throw new UpstreamError(`${label}: response too large`);
  const text = await response.text();
  if (text.length > MAX_BODY_BYTES) throw new UpstreamError(`${label}: response too large`);
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new UpstreamError(`${label}: response is not JSON`, error);
  }
}
