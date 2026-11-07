/**
 * The public origin (scheme + host) the browser used to reach the app, for redirects.
 *
 * In the standalone/Docker server `request.url` reports the bind address
 * (e.g. http://0.0.0.0:3000), so redirects must not be built from it.
 * Order: SITE_URL env (recommended in production) -> X-Forwarded-* headers, only when
 * TRUST_PROXY_HEADERS=true (a reverse proxy sets/overwrites them) -> Host header.
 *
 * Never use this for links sent to other people (emails): headers come from the caller.
 */
export function getRequestOrigin(request: Request): string {
    const configured = process.env.SITE_URL?.trim();
    if (configured) return configured.replace(/\/+$/, '');

    const headers = request.headers;
    const fallback = new URL(request.url);
    const trustProxy = process.env.TRUST_PROXY_HEADERS === 'true';
    const forwardedHost = trustProxy ? headers.get('x-forwarded-host')?.split(',')[0].trim() : undefined;
    const forwardedProto = trustProxy ? headers.get('x-forwarded-proto')?.split(',')[0].trim() : undefined;
    const host = forwardedHost || headers.get('host') || fallback.host;
    const proto = (forwardedProto || fallback.protocol.replace(':', '')) === 'https' ? 'https' : 'http';
    return `${proto}://${host}`;
}
