import { NextRequest, NextResponse } from 'next/server';

/**
 * Next 16 request proxy (the renamed middleware).
 *
 * Sends anonymous visitors of /admin/* to /login. This is a presence check on cookies only:
 * `su_session` is the httpOnly session the API issues (2.8+); `su_auth_hint` is the plain marker
 * the console sets at login so the check also works while an older API is deployed. Authorization
 * itself is enforced by the API on every call; a forged cookie only ever yields a shell with no data.
 */
const SESSION_COOKIE = 'su_session';
const AUTH_HINT_COOKIE = 'su_auth_hint';

export function proxy(request: NextRequest) {
    const { pathname, search } = request.nextUrl;
    if (!pathname.startsWith('/admin')) return NextResponse.next();

    const hasSession = request.cookies.has(SESSION_COOKIE) || request.cookies.has(AUTH_HINT_COOKIE);
    if (hasSession) return NextResponse.next();

    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    url.searchParams.set('next', pathname + search);
    return NextResponse.redirect(url);
}

export const config = {
    matcher: ['/admin/:path*'],
};
