import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export const OWNER_ID = '00000000-0000-4000-8000-000000000001';
export type Row = Record<string, any>;
export const dataDirectory = () =>
  process.env.WQN_DATA_DIR
    ? resolve(/* turbopackIgnore: true */ process.env.WQN_DATA_DIR)
    : resolve(process.cwd(), 'data');
let connection: DatabaseSync | undefined;
let connectionPath: string | undefined;

export function database() {
  const directory = dataDirectory();
  if (connection && connectionPath === directory) return connection;
  connection?.close();
  mkdirSync(directory, { recursive: true });
  connection = new DatabaseSync(resolve(directory, 'notebook.sqlite'));
  connectionPath = directory;
  connection.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS records (
      collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL CHECK(json_valid(body)),
      PRIMARY KEY(collection, id));
    CREATE INDEX IF NOT EXISTS records_subject ON records(collection, json_extract(body, '$.subject_id'));
    CREATE INDEX IF NOT EXISTS records_problem ON records(collection, json_extract(body, '$.problem_id'));
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS auth_throttle (id INTEGER PRIMARY KEY CHECK(id=1), failures INTEGER NOT NULL, blocked_until INTEGER NOT NULL);
  `);
  const now = new Date().toISOString();
  connection.prepare('INSERT OR IGNORE INTO records VALUES (?, ?, ?)').run(
    'user_profiles',
    OWNER_ID,
    JSON.stringify({
      id: OWNER_ID,
      username: 'owner',
      first_name: '我的错题本',
      last_name: '',
      email: 'owner@localhost',
      user_role: 'user',
      is_active: true,
      timezone: 'Asia/Shanghai',
      onboarding_completed_at: now,
      created_at: now,
      updated_at: now,
    })
  );
  return connection;
}

export function rows(collection: string): Row[] {
  return database()
    .prepare('SELECT body FROM records WHERE collection = ?')
    .all(collection)
    .map(r => JSON.parse(String(r.body)));
}
export function save(collection: string, row: Row) {
  database()
    .prepare(
      'INSERT INTO records VALUES (?, ?, ?) ON CONFLICT(collection,id) DO UPDATE SET body=excluded.body'
    )
    .run(collection, row.id, JSON.stringify(row));
  return row;
}
export function insert(collection: string, input: Row) {
  if (collection === 'problem_sets')
    input = {
      ...input,
      sharing_level: 'private',
      is_listed: false,
      allow_copying: false,
    };
  const now = new Date().toISOString();
  const defaults: Row =
    collection === 'problems'
      ? {
          status: 'needs_review',
          assets: [],
          solution_assets: [],
          last_reviewed_date: null,
        }
      : collection === 'review_schedule'
        ? {
            ease_factor: 2.5,
            repetition_number: 0,
            interval_days: 1,
            next_review_at: now,
            last_reviewed_at: null,
          }
        : collection === 'review_session_state'
          ? {
              started_at: now,
              last_activity_at: now,
              is_active: true,
              completed_at: null,
            }
          : collection === 'problem_sets'
            ? {
                sharing_level: 'private',
                is_smart: false,
                is_listed: false,
                allow_copying: false,
                description: null,
              }
            : {};
  const row = {
    user_id: OWNER_ID,
    created_at: now,
    updated_at: now,
    ...defaults,
    ...input,
    id: input.id || randomUUID(),
  };
  if (rows(collection).some(r => r.id === row.id))
    throw new Error('Duplicate record ID');
  validateRelations(collection, row);
  return save(collection, row);
}
function validateRelations(collection: string, row: Row) {
  for (const [key, target] of Object.entries({
    subject_id: 'subjects',
    problem_id: 'problems',
    tag_id: 'tags',
    problem_set_id: 'problem_sets',
    session_state_id: 'review_session_state',
  })) {
    if (row[key] && !rows(target).some(r => r.id === row[key]))
      throw new Error(`Missing ${target} record`);
  }
  if (collection === 'problem_tag') {
    const problem = rows('problems').find(r => r.id === row.problem_id);
    const tag = rows('tags').find(r => r.id === row.tag_id);
    if (problem?.subject_id !== tag?.subject_id)
      throw new Error('Tag belongs to another notebook');
  }
}
export function update(collection: string, previous: Row, changes: Row) {
  if (collection === 'problem_sets')
    changes = {
      ...changes,
      sharing_level: 'private',
      is_listed: false,
      allow_copying: false,
    };
  const row: Row = {
    ...previous,
    ...changes,
    id: previous.id,
    updated_at: new Date().toISOString(),
  };
  validateRelations(collection, row);
  if (collection === 'problems' && previous.status !== row.status) {
    insert('problem_status_history', {
      problem_id: row.id,
      old_status: previous.status,
      new_status: row.status,
      changed_at: row.updated_at,
    });
  }
  return save(collection, row);
}
export function remove(collection: string, row: Row) {
  const children: Record<string, Record<string, string>> = {
    subjects: {
      problems: 'subject_id',
      tags: 'subject_id',
      problem_sets: 'subject_id',
      review_session_state: 'subject_id',
    },
    problems: {
      problem_tag: 'problem_id',
      attempts: 'problem_id',
      review_schedule: 'problem_id',
      problem_set_problems: 'problem_id',
      review_session_results: 'problem_id',
      problem_status_history: 'problem_id',
    },
    tags: { problem_tag: 'tag_id' },
    problem_sets: {
      problem_set_problems: 'problem_set_id',
      problem_set_shares: 'problem_set_id',
      review_session_state: 'problem_set_id',
    },
    review_session_state: { review_session_results: 'session_state_id' },
  };
  for (const [child, key] of Object.entries(children[collection] || {})) {
    for (const item of rows(child).filter(r => r[key] === row.id))
      remove(child, item);
  }
  database()
    .prepare('DELETE FROM records WHERE collection=? AND id=?')
    .run(collection, row.id);
}
export function transaction<T>(operation: () => T): T {
  const db = database();
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
