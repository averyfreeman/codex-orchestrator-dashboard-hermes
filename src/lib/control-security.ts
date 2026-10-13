/** Validate same-origin browser requests; this is CSRF defense, not user authentication. */
export function isSameOriginDashboardRequest(request: Request): boolean {
  // Same-origin GET fetches commonly omit Origin, so use the browser's
  // same-origin Referer as the equivalent signal for read-only status routes.
  const origin = request.headers.get("origin") ?? request.headers.get("referer");
  const host = request.headers.get("host");
  if (!origin || !host) return false;
  try {
    const requestUrl = new URL(request.url);
    const originUrl = new URL(origin);
    const hostUrl = new URL(`${requestUrl.protocol}//${host}`);
    return originUrl.origin === hostUrl.origin && hostUrl.origin === requestUrl.origin;
  } catch {
    return false;
  }
}
