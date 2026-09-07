import type { SupabaseClient } from '@supabase/supabase-js';
import { LocalQuery } from './query';
import { localRpc } from './rpc';
import { localStorage } from './storage';
import { OWNER } from './auth';

export function createLocalClient(authenticated = true): SupabaseClient {
  return {
    from: (table: string) => new LocalQuery(table),
    rpc: (name: string, args?: Record<string, any>) => {
      const result = localRpc(name, args);
      return Object.assign(Promise.resolve(result), {
        single: () =>
          Promise.resolve({
            ...result,
            data: Array.isArray(result.data)
              ? result.data[0] || null
              : result.data,
          }),
      });
    },
    storage: { from: localStorage },
    auth: {
      getUser: async () => ({
        data: { user: authenticated ? OWNER : null },
        error: null,
      }),
      getClaims: async () => ({
        data: { claims: authenticated ? { ...OWNER, sub: OWNER.id } : null },
        error: null,
      }),
      getSession: async () => ({
        data: { session: authenticated ? { user: OWNER } : null },
        error: null,
      }),
    },
  } as unknown as SupabaseClient;
}
