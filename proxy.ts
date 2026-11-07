import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

// Next.js 16 "proxy" (formerly middleware). Refreshes the Supabase session cookie and
// gates pages. NOTE: this only protects *pages*. Data access is enforced by the row
// level security policies in supabase/migrations and by the checks in app/api/*.

const PROTECTED_PREFIXES = ['/home', '/admin', '/settings', '/onboarding'];

export async function proxy(request: NextRequest) {
    let response = NextResponse.next({ request });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        return new NextResponse('Server is missing Supabase configuration.', { status: 500 });
    }

    const supabase = createServerClient(url, anonKey, {
        cookies: {
            getAll() {
                return request.cookies.getAll();
            },
            setAll(cookiesToSet) {
                cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
                response = NextResponse.next({ request });
                cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
            },
        },
    });

    const { data: { user } } = await supabase.auth.getUser();
    const { pathname } = request.nextUrl;

    const redirectTo = (path: string) => {
        const target = request.nextUrl.clone();
        target.pathname = path;
        target.search = '';
        const redirect = NextResponse.redirect(target);
        // Keep any refreshed auth cookies.
        response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
        return redirect;
    };

    // 1. Authentication
    if (!user) {
        if (PROTECTED_PREFIXES.some((p) => pathname.startsWith(p))) return redirectTo('/login');
        return response;
    }

    const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, signature_url, role, is_active')
        .eq('id', user.id)
        .maybeSingle();

    // 2. Deactivated accounts are signed out (their login is also banned in Supabase Auth).
    if (profile && profile.is_active === false) {
        await supabase.auth.signOut();
        const target = request.nextUrl.clone();
        target.pathname = '/login';
        target.search = '?error=account-disabled';
        const redirect = NextResponse.redirect(target);
        response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
        return redirect;
    }

    // 3. Onboarding gate: a name and signature are required before using the app.
    if (!pathname.startsWith('/onboarding') && (!profile?.full_name || !profile?.signature_url)) {
        return redirectTo('/onboarding');
    }

    // 4. Admin gate (role is stored in profiles.role, editable only via SQL / service role).
    if (pathname.startsWith('/admin') && profile?.role !== 'admin') {
        return redirectTo('/home');
    }

    return response;
}

export const config = {
    matcher: ['/home/:path*', '/admin/:path*', '/onboarding/:path*', '/settings/:path*'],
};
