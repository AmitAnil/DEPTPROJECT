import { afterEach, describe, expect, it } from 'vitest';
import { getRequestOrigin } from '@/lib/requestOrigin';

const req = (headers: Record<string, string>) => new Request('http://0.0.0.0:3000/auth/callback', { headers });

describe('getRequestOrigin', () => {
    afterEach(() => { delete process.env.SITE_URL; delete process.env.TRUST_PROXY_HEADERS; });

    it('prefers SITE_URL', () => {
        process.env.SITE_URL = 'https://deptdocs.example.edu/';
        expect(getRequestOrigin(req({ host: 'other' }))).toBe('https://deptdocs.example.edu');
    });
    it('ignores forwarded headers unless the operator trusts the proxy', () => {
        expect(getRequestOrigin(req({ host: 'deptdocs.example.edu', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }))).toBe('http://deptdocs.example.edu');
    });
    it('uses forwarded headers from a trusted reverse proxy', () => {
        process.env.TRUST_PROXY_HEADERS = 'true';
        expect(getRequestOrigin(req({ host: '10.0.0.5:3000', 'x-forwarded-host': 'docs.example.edu', 'x-forwarded-proto': 'https' }))).toBe('https://docs.example.edu');
    });
    it('falls back to the Host header, never the bind address', () => {
        expect(getRequestOrigin(req({ host: 'localhost:3000' }))).toBe('http://localhost:3000');
    });
});
