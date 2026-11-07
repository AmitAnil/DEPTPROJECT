import { describe, expect, it } from 'vitest';
import { isSafeInternalLink, safeRedirectPath } from '@/lib/redirect';

describe('safeRedirectPath', () => {
    it('keeps same-site paths', () => {
        expect(safeRedirectPath('/home')).toBe('/home');
        expect(safeRedirectPath('/auth/reset-password')).toBe('/auth/reset-password');
        expect(safeRedirectPath('/home/new?id=abc#x')).toBe('/home/new?id=abc#x');
    });

    it.each([
        '@evil.com',
        '//evil.com',
        '/\\evil.com',
        'https://evil.com',
        'javascript:alert(1)',
        '/\t/evil.com',
        '/..//evil.com',
        '/.//evil.com',
        '/../\\evil.com',
        '',
    ])('rejects %j', (next) => {
        expect(safeRedirectPath(next)).toBe('/home');
    });

    it('uses the fallback for missing values', () => {
        expect(safeRedirectPath(null, '/login')).toBe('/login');
    });
});

describe('isSafeInternalLink', () => {
    it('accepts internal links and rejects external ones', () => {
        expect(isSafeInternalLink('/home/new?id=1')).toBe(true);
        expect(isSafeInternalLink('https://phish.example')).toBe(false);
        expect(isSafeInternalLink('//phish.example')).toBe(false);
        expect(isSafeInternalLink(undefined)).toBe(false);
    });
});
