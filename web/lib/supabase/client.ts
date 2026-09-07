import type { SupabaseClient } from '@supabase/supabase-js';
const url = (bucket: string, path: string) =>
  `/api/local/files?bucket=${encodeURIComponent(bucket)}&path=${encodeURIComponent(path)}`;
async function currentUser() {
  const response = await fetch('/api/local/auth', { cache: 'no-store' });
  const data = await response.json();
  return { data: { user: data.user || null }, error: null };
}
export function createClient(): SupabaseClient {
  return {
    auth: {
      getUser: currentUser,
      getSession: async () => {
        const { data } = await currentUser();
        return {
          data: { session: data.user ? { user: data.user } : null },
          error: null,
        };
      },
      signOut: async () => {
        await fetch('/api/local/auth', { method: 'DELETE' });
        return { error: null };
      },
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (
          path: string,
          file: File,
          options: { upsert?: boolean } = {}
        ) => {
          const body = new FormData();
          body.set('file', file);
          body.set('bucket', bucket);
          body.set('path', path);
          body.set('upsert', String(!!options.upsert));
          const response = await fetch('/api/local/files', {
            method: 'POST',
            body,
          });
          const result = await response.json();
          if (!response.ok)
            return {
              data: null,
              error: {
                message:
                  typeof result.error === 'string'
                    ? result.error
                    : result.error?.message || '上传失败',
              },
            };
          return result;
        },
        createSignedUrls: async (paths: string[]) => ({
          data: paths.map(path => ({ path, signedUrl: url(bucket, path) })),
          error: null,
        }),
        createSignedUrl: async (path: string) => ({
          data: { signedUrl: url(bucket, path) },
          error: null,
        }),
        getPublicUrl: (path: string) => ({
          data: { publicUrl: url(bucket, path) },
        }),
      }),
    },
  } as unknown as SupabaseClient;
}
