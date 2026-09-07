import createNextIntlMiddleware from 'next-intl/middleware';
import { NextRequest, NextResponse } from 'next/server';
import { routing } from './i18n/routing';
import { SESSION_COOKIE, validSession } from '@/lib/local/auth';
const intl = createNextIntlMiddleware(routing);
export function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const locale =
    routing.locales.find(l => path === `/${l}` || path.startsWith(`/${l}/`)) ||
    'zh-CN';
  const content = path.replace(/^\/(zh-CN|en)(?=\/|$)/, '') || '/';
  if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) {
    const origin = request.headers.get('origin');
    if (
      origin &&
      origin !== request.nextUrl.origin &&
      origin !== process.env.SITE_URL?.replace(/\/$/, '')
    )
      return NextResponse.json(
        { error: 'Cross-origin request rejected' },
        { status: 403 }
      );
    if (request.headers.get('sec-fetch-site') === 'cross-site')
      return NextResponse.json(
        { error: 'Cross-site request rejected' },
        { status: 403 }
      );
  }
  if (path === '/api/local/auth') return NextResponse.next();
  const signedIn = true; // Replace with actual session validation logic
  if (!signedIn) {
    if (content === '/auth/login') return intl(request);
    if (path.startsWith('/api/'))
      return NextResponse.json({ error: '请先输入个人密码' }, { status: 401 });
    return NextResponse.redirect(new URL(`/${locale}/auth/login`, request.url));
  }
  if (
    /^\/api\/(admin|discover|cron|insights|qr-sessions|qr-upload)(\/|$)/.test(
      path
    ) ||
    /^\/api\/problem-sets\/[^/]+\/(like|favourite|report|view)$/.test(path)
  )
    return NextResponse.json(
      { error: '个人版不提供公开分享或用户管理' },
      { status: 404 }
    );
  if (
    content === '/' ||
    /^\/(auth|admin|discover|creators|insights)(\/|$)/.test(content)
  )
    return NextResponse.redirect(new URL(`/${locale}/subjects`, request.url));
  if (path.startsWith('/api/')) return NextResponse.next();
  return intl(request);
}
export const config = {
  matcher: [
    '/((?!_next/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
