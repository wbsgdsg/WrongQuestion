import { rows, insert, save, transaction, type Row } from './database';

export function localRpc(name: string, args: Row = {}) {
  try {
    const problems = rows('problems');
    const subjects = rows('subjects');
    const schedules = rows('review_schedule');
    const history = rows('problem_status_history');
    const now = new Date().toISOString();
    const due = (p: Row) =>
      p.status !== 'mastered' &&
      schedules.some(s => s.problem_id === p.id && s.next_review_at <= now);
    const counts = (items: Row[]) => ({
      total: items.length,
      mastered: items.filter(p => p.status === 'mastered').length,
      needs_review: items.filter(p => p.status === 'needs_review').length,
      wrong: items.filter(p => p.status === 'wrong').length,
    });
    const day = (date: string) =>
      new Intl.DateTimeFormat('en-CA', {
        timeZone: args.p_user_tz || 'UTC',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date(date));
    let data: any;
    switch (name) {
      case 'get_subjects_with_metadata':
        data = subjects.map(s => {
          const items = problems.filter(p => p.subject_id === s.id);
          return {
            ...s,
            problem_count: items.length,
            due_count: items.filter(due).length,
            last_activity:
              items
                .map(p => p.updated_at)
                .sort()
                .at(-1) || s.created_at,
          };
        });
        break;
      case 'get_due_problems_for_subject':
        data = problems
          .filter(p => p.subject_id === args.p_subject_id && due(p))
          .slice(0, args.p_limit || 20);
        break;
      case 'get_user_statistics': {
        const c = counts(problems);
        data = {
          total_problems: c.total,
          mastered_count: c.mastered,
          needs_review_count: c.needs_review,
          wrong_count: c.wrong,
          mastery_rate: c.total ? (c.mastered / c.total) * 100 : 0,
        };
        break;
      }
      case 'get_subject_breakdown':
        data = subjects.map(s => {
          const c = counts(problems.filter(p => p.subject_id === s.id));
          return {
            subject_id: s.id,
            subject_name: s.name,
            ...c,
            mastery_pct: c.total ? (c.mastered / c.total) * 100 : 0,
          };
        });
        break;
      case 'get_session_statistics': {
        const sessions = rows('review_session_state').filter(s => !s.is_active);
        const duration = sessions.reduce(
          (sum, s) => sum + (s.session_state?.elapsed_ms || 0),
          0
        );
        data = {
          total_sessions: sessions.length,
          total_review_time_ms: duration,
          avg_duration_ms: sessions.length ? duration / sessions.length : 0,
          avg_problems_per_session: sessions.length
            ? sessions.reduce(
                (sum, s) =>
                  sum + (s.session_state?.completed_problem_ids?.length || 0),
                0
              ) / sessions.length
            : 0,
        };
        break;
      }
      case 'get_recent_study_activity':
        data = history
          .sort((a, b) => b.changed_at.localeCompare(a.changed_at))
          .slice(0, 20)
          .map(h => {
            const p = problems.find(p => p.id === h.problem_id);
            return {
              ...h,
              problem_title: p?.title || '',
              subject_name:
                subjects.find(s => s.id === p?.subject_id)?.name || '',
            };
          });
        break;
      case 'get_activity_heatmap': {
        const dates: Record<string, number> = {};
        for (const a of rows('attempts')) {
          const key = day(a.created_at);
          dates[key] = (dates[key] || 0) + 1;
        }
        data = Object.entries(dates).map(([activity_date, activity_count]) => ({
          activity_date,
          activity_count,
        }));
        break;
      }
      case 'get_study_streaks': {
        const dates = [
          ...new Set(rows('attempts').map(a => day(a.created_at))),
        ].sort();
        let longest = 0,
          current = 0,
          previous = '';
        for (const date of dates) {
          current =
            previous && Date.parse(date) - Date.parse(previous) === 86400000
              ? current + 1
              : 1;
          longest = Math.max(longest, current);
          previous = date;
        }
        const today = day(now);
        data = {
          longest_streak: longest,
          current_streak:
            previous && Date.parse(today) - Date.parse(previous) <= 86400000
              ? current
              : 0,
        };
        break;
      }
      case 'get_weekly_progress': {
        const points: Row[] = [];
        for (let i = 11; i >= 0; i--) {
          const start = new Date(now);
          start.setUTCDate(
            start.getUTCDate() - ((start.getUTCDay() + 6) % 7) - i * 7
          );
          start.setUTCHours(0, 0, 0, 0);
          const end = new Date(start.getTime() + 7 * 86400000).toISOString();
          const mastered = problems.filter(p => {
            if (p.created_at >= end) return false;
            const changes = history
              .filter(h => h.problem_id === p.id)
              .sort((a, b) => a.changed_at.localeCompare(b.changed_at));
            return (
              (changes.filter(h => h.changed_at < end).at(-1)?.new_status ??
                changes[0]?.old_status ??
                p.status) === 'mastered'
            );
          }).length;
          points.push({
            week_start: start.toISOString().slice(0, 10),
            cumulative_mastered: mastered,
          });
        }
        data = points;
        break;
      }
      case 'get_user_storage_bytes':
        data = rows('local_files').reduce((n, f) => n + f.size, 0);
        break;
      case 'get_unreferenced_asset_paths':
        data = args.p_paths.filter(
          (path: string) =>
            !problems.some(
              p =>
                p.id !== args.p_exclude_problem_id &&
                [...(p.assets || []), ...(p.solution_assets || [])].some(
                  a => a.path === path
                )
            )
        );
        break;
      case 'find_problem_by_asset':
        data = problems.filter(p =>
          [...(p.assets || []), ...(p.solution_assets || [])].some(
            a => a.path === args.p_path
          )
        );
        break;
      case 'can_view_problem':
        data = problems.some(p => p.id === args.p_problem_id);
        break;
      case 'user_owns_problem_with_asset':
        data = problems.some(p =>
          [...(p.assets || []), ...(p.solution_assets || [])].some(
            a => a.path === args.p_path
          )
        );
        break;
      case 'log_user_activity':
        insert('user_activity_logs', {
          activity_type: args.p_activity_type,
          metadata: args.p_metadata,
        });
        data = null;
        break;
      case 'check_and_increment_quota':
        data = transaction(() => {
          const period = day(now);
          const existing = rows('usage_quotas').find(
            r =>
              r.period_start === period &&
              r.resource_type === args.p_resource_type
          );
          const used = existing?.usage_count || 0,
            limit = args.p_default_limit || 30;
          if (used >= limit)
            return {
              allowed: false,
              current_usage: used,
              daily_limit: limit,
              remaining: 0,
            };
          if (existing)
            save('usage_quotas', { ...existing, usage_count: used + 1 });
          else
            insert('usage_quotas', {
              resource_type: args.p_resource_type,
              period_start: period,
              usage_count: 1,
            });
          return {
            allowed: true,
            current_usage: used + 1,
            daily_limit: limit,
            remaining: limit - used - 1,
          };
        });
        break;
      default:
        throw new Error(`个人版不支持此操作: ${name}`);
    }
    return { data, error: null };
  } catch (error) {
    return {
      data: null,
      error: {
        message: error instanceof Error ? error.message : String(error),
      },
    };
  }
}
