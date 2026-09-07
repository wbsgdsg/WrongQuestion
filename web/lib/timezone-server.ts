import { createServiceClient } from './supabase-utils';
import { DEFAULT_TIMEZONE, isValidTimezone } from './timezone-utils';

export async function getUserTimezone(userId: string): Promise<string> {
  try {
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from('user_profiles')
      .select('timezone')
      .eq('id', userId)
      .single();

    if (error || !data?.timezone) return DEFAULT_TIMEZONE;
    return isValidTimezone(data.timezone) ? data.timezone : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
