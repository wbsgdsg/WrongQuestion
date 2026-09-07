import { NextRequest, NextResponse } from 'next/server';
import { localStorage, storagePath } from '@/lib/local/storage';
import { requireUser, unauthorised } from '@/lib/supabase/requireUser';
import { readFile } from 'node:fs/promises';
import { rows } from '@/lib/local/database';

export async function GET(req: NextRequest) {
  const { user } = await requireUser();
  if (!user) return unauthorised();
  const bucket = req.nextUrl.searchParams.get('bucket') || 'problem-assets';
  const path = req.nextUrl.searchParams.get('path') || '';
  try {
    const bytes = await readFile(storagePath(bucket, path));
    const metadata = rows('local_files').find(
      f => f.bucket === bucket && f.path === path
    );
    const type = metadata?.content_type || 'application/octet-stream';
    const inline = [
      'image/png',
      'image/jpeg',
      'image/webp',
      'image/gif',
      'application/pdf',
    ].includes(type);
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': type,
        'Content-Disposition': inline ? 'inline' : 'attachment',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "sandbox; default-src 'none'",
      },
    });
  } catch {
    return NextResponse.json({ error: '文件不存在' }, { status: 404 });
  }
}
export async function POST(req: NextRequest) {
  const { user } = await requireUser();
  if (!user) return unauthorised();
  if (Number(req.headers.get('content-length') || 0) > 11 * 1024 * 1024)
    return NextResponse.json({ error: '文件过大' }, { status: 413 });
  try {
    const form = await req.formData();
    const file = form.get('file');
    const bucket = String(form.get('bucket') || ''),
      path = String(form.get('path') || '');
    if (
      !(file instanceof File) ||
      ![
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/gif',
        'application/pdf',
      ].includes(file.type)
    )
      return NextResponse.json(
        { error: { message: '仅支持图片或 PDF' } },
        { status: 400 }
      );
    const result = await localStorage(bucket).upload(path, file, {
      upsert: form.get('upsert') === 'true',
    });
    return NextResponse.json(result, { status: result.error ? 400 : 201 });
  } catch {
    return NextResponse.json(
      { error: { message: '上传失败' } },
      { status: 400 }
    );
  }
}
