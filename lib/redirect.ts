/**
 * Returns `next` only if it is a same-origin relative path, otherwise `fallback`.
 * Prevents open redirects such as `?next=@evil.com` or `?next=//evil.com`.
 */
export function safeRedirectPath(next: string | null | undefined, fallback = '/home'): string {
    if (!next || typeof next !== 'string') return fallback;
    // Must be an absolute path on this site: one leading slash, no protocol-relative or backslash tricks.
    if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
    // Reject control characters (tab/newline can be stripped by browsers to form "//").
    if (/[\u0000-\u001F\u007F]/.test(next)) return fallback;
    try {
        const base = 'http://local.invalid';
        const url = new URL(next, base);
        if (url.origin !== base) return fallback;
        // Dot segments are resolved by URL(): "/..//evil.com" becomes "//evil.com". Check the result too.
        const path = `${url.pathname}${url.search}${url.hash}`;
        if (path.startsWith('//') || path.startsWith('/\\')) return fallback;
        return path;
    } catch {
        return fallback;
    }
}

/** True for links that are safe to navigate to from stored data (notifications etc.). */
export function isSafeInternalLink(link: string | null | undefined): link is string {
    return !!link && safeRedirectPath(link, '') === link;
}
