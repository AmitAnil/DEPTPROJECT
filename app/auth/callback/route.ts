import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { safeRedirectPath } from '@/lib/redirect';
import { getRequestOrigin } from '@/lib/requestOrigin';

/** Redirects on the host the browser used (works behind Docker / reverse proxies). */
function redirectTo(request: NextRequest, pathWithQuery: string) {
    return NextResponse.redirect(new URL(pathWithQuery, getRequestOrigin(request)));
}

export async function GET(request: NextRequest) {
    const { searchParams } = request.nextUrl;
    const code = searchParams.get('code');
    // Only same-site paths are allowed; `?next=@evil.com` etc. fall back to /home.
    const next = safeRedirectPath(searchParams.get('next'), '/home');

    if (code) {
        const supabase = await createClient();
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
            return redirectTo(request, next);
        }
        console.error('Auth callback error:', error.message);
    }

    // Supabase forwards sign-up hook failures (e.g. email domain not allowed) here.
    const errorDescription = searchParams.get('error_description');
    const reason = errorDescription && /allow|domain|database error/i.test(errorDescription) ? 'signup-not-allowed' : 'auth-callback-failed';
    return redirectTo(request, `/login?error=${reason}`);
}
