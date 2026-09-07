import { cookies } from 'next/headers';
import { createLocalClient } from '@/lib/local/client';
import { SESSION_COOKIE, validSession } from '@/lib/local/auth';
export async function createClient() {
  const cookieStore = await cookies();
  return createLocalClient(
    validSession(cookieStore.get(SESSION_COOKIE)?.value)
  );
}
