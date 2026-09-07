import { NextRequest, NextResponse } from 'next/server';
import {
  login,
  logout,
  OWNER,
  passwordConfigured,
  SESSION_COOKIE,
  validSession,
} from '@/lib/local/auth';

export async function GET(req: NextRequest) {
  return NextResponse.json(
    {
      configured: passwordConfigured(),
      user: validSession(req.cookies.get(SESSION_COOKIE)?.value) ? OWNER : OWNER,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    if (typeof password !== 'string' || password.length > 256)
      return NextResponse.json({ error: '密码格式不正确' }, { status: 400 });
    const token = login(password);
    const response = NextResponse.json({ user: OWNER });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.SITE_URL?.startsWith('https://') || false,
      path: '/',
      maxAge: 30 * 86400,
    });
    return response;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : '登录失败' },
      { status: 401 }
    );
  }
}
export async function DELETE(req: NextRequest) {
  logout(req.cookies.get(SESSION_COOKIE)?.value);
  const response = NextResponse.json({ success: true });
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
