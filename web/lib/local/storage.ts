import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { dataDirectory, rows, save, remove } from './database';
import { randomUUID } from 'node:crypto';

export function storagePath(bucket: string, path: string) {
  if (
    !/^[a-zA-Z0-9_-]+$/.test(bucket) ||
    !path ||
    path.includes('\\') ||
    path.includes('\0') ||
    path.split('/').some(p => !p || p === '.' || p === '..' || p.includes(':'))
  )
    throw new Error('Invalid file path');
  const root = resolve(dataDirectory(), 'uploads', bucket),
    target = resolve(root, path);
  if (!target.startsWith(root + sep)) throw new Error('Invalid file path');
  return target;
}
export const fileUrl = (bucket: string, path: string) =>
  `/api/local/files?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
const failure = (error: unknown) => ({
  data: null,
  error: { message: error instanceof Error ? error.message : String(error) },
});
export function localStorage(bucket: string) {
  return {
    async upload(
      path: string,
      file: Blob | ArrayBuffer | Buffer,
      options: { upsert?: boolean; contentType?: string } = {}
    ) {
      try {
        const target = storagePath(bucket, path);
        const bytes =
          file instanceof Blob
            ? Buffer.from(await file.arrayBuffer())
            : Buffer.from(file as ArrayBuffer);
        if (bytes.length > 10 * 1024 * 1024)
          throw new Error('文件不能超过 10MB');
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: options.upsert ? 'w' : 'wx' });
        const existing = rows('local_files').find(
          f => f.bucket === bucket && f.path === path
        );
        save('local_files', {
          id: existing?.id || randomUUID(),
          bucket,
          path,
          size: bytes.length,
          content_type:
            options.contentType ||
            (file instanceof Blob ? file.type : '') ||
            'application/octet-stream',
        });
        return { data: { path }, error: null };
      } catch (error) {
        return failure(error);
      }
    },
    async download(path: string) {
      try {
        return {
          data: new Blob([
            new Uint8Array(await readFile(storagePath(bucket, path))),
          ]),
          error: null,
        };
      } catch (error) {
        return failure(error);
      }
    },
    async remove(paths: string[]) {
      try {
        const targets = paths.map(path => ({
          path,
          target: storagePath(bucket, path),
        }));
        for (const { path, target } of targets) {
          try {
            await unlink(target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          }
          for (const entry of rows('local_files').filter(
            f => f.bucket === bucket && f.path === path
          ))
            remove('local_files', entry);
        }
        return { data: paths.map(name => ({ name })), error: null };
      } catch (error) {
        return failure(error);
      }
    },
    async list(prefix = '', options: { limit?: number; offset?: number } = {}) {
      const base = prefix && !prefix.endsWith('/') ? prefix + '/' : prefix;
      const entries = new Map<string, any>();
      for (const file of rows('local_files').filter(
        f => f.bucket === bucket && f.path.startsWith(base)
      )) {
        const remaining = file.path.slice(base.length),
          name = remaining.split('/')[0];
        entries.set(name, {
          name,
          metadata: remaining.includes('/') ? null : { size: file.size },
        });
      }
      return {
        data: [...entries.values()]
          .sort((a, b) => a.name.localeCompare(b.name))
          .slice(
            options.offset || 0,
            (options.offset || 0) + (options.limit || 1000)
          ),
        error: null,
      };
    },
    async createSignedUrl(path: string) {
      storagePath(bucket, path);
      return { data: { signedUrl: fileUrl(bucket, path) }, error: null };
    },
    async createSignedUrls(paths: string[]) {
      return {
        data: paths.map(path => {
          storagePath(bucket, path);
          return { path, signedUrl: fileUrl(bucket, path) };
        }),
        error: null,
      };
    },
    getPublicUrl(path: string) {
      storagePath(bucket, path);
      return { data: { publicUrl: fileUrl(bucket, path) } };
    },
  };
}
