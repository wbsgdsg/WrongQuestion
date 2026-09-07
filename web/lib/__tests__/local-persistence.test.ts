import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scryptSync, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { database, OWNER_ID, rows } from '../local/database';
import { LocalQuery } from '../local/query';
import { localRpc } from '../local/rpc';
import { localStorage, storagePath } from '../local/storage';
import { login, logout, validSession } from '../local/auth';

const previousDirectory = process.env.WQN_DATA_DIR;
const directory = mkdtempSync(join(tmpdir(), 'wqn-test-'));
beforeAll(() => {
  process.env.WQN_DATA_DIR = directory;
});
afterAll(() => {
  if (previousDirectory === undefined) delete process.env.WQN_DATA_DIR;
  else process.env.WQN_DATA_DIR = previousDirectory;
});
const table = (name: string) => new LocalQuery(name);

describe('personal notebook persistence', () => {
  it('persists notebooks, rich text, tags and review state in a real SQLite file', async () => {
    const subject = (
      await table('subjects').insert({ name: '数学' }).select().single()
    ).data;
    const tag = (
      await table('tags')
        .insert({ name: '代数', subject_id: subject.id })
        .single()
    ).data;
    const problem = (
      await table('problems')
        .insert({
          subject_id: subject.id,
          title: '方程, (一)',
          content: '<p>x + 2 = 3</p>',
          problem_type: 'short',
          correct_answer: '1',
        })
        .single()
    ).data;
    expect(
      (
        await table('problem_tag').insert({
          problem_id: problem.id,
          tag_id: tag.id,
        })
      ).error
    ).toBeNull();
    await table('review_schedule').upsert(
      { user_id: OWNER_ID, problem_id: problem.id },
      { onConflict: 'user_id,problem_id' }
    );
    expect(localRpc('get_subjects_with_metadata').data[0]).toMatchObject({
      problem_count: 1,
      due_count: 1,
    });
    const query = await table('problems')
      .select('*, problem_tag(tags:tag_id(id,name)), subjects(name)')
      .or('title.ilike."%方程, (一)%"');
    expect(query.error).toBeNull();
    expect(query.data[0].problem_tag[0].tags.name).toBe('代数');
    expect(query.data[0].subjects.name).toBe('数学');
    await table('problems').update({ status: 'mastered' }).eq('id', problem.id);
    expect(localRpc('get_user_statistics').data.mastered_count).toBe(1);
    const secondConnection = new DatabaseSync(
      join(directory, 'notebook.sqlite')
    );
    const persisted = secondConnection
      .prepare('SELECT body FROM records WHERE collection=? AND id=?')
      .get('problems', problem.id);
    expect(JSON.parse(String(persisted?.body))).toMatchObject({
      content: '<p>x + 2 = 3</p>',
      status: 'mastered',
    });
    secondConnection.close();
    await table('subjects').delete().eq('id', subject.id);
    for (const collection of [
      'problems',
      'tags',
      'problem_tag',
      'review_schedule',
      'problem_status_history',
    ])
      expect(rows(collection)).toHaveLength(0);
  });
  it('rolls back a failed batch and handles null filters and missing records', async () => {
    const result = await table('problems').insert([
      { title: 'would be partial' },
      { subject_id: 'missing', title: 'invalid' },
    ]);
    expect(result.error).not.toBeNull();
    expect(rows('problems')).toHaveLength(0);
    expect(
      (await table('problems').eq('id', 'missing').single()).error?.code
    ).toBe('PGRST116');
    expect((await table('problems').maybeSingle()).data).toBeNull();
  });
  it('writes attachments to disk, reads identical bytes, and rejects path traversal', async () => {
    const store = localStorage('problem-uploads');
    const path = `user/${OWNER_ID}/problems/test/problem/example.pdf`;
    const result = await store.upload(
      path,
      new Blob(['%PDF-1.4 test'], { type: 'application/pdf' })
    );
    expect(result.error).toBeNull();
    expect(await (await store.download(path)).data?.text()).toBe(
      '%PDF-1.4 test'
    );
    expect(
      (await store.upload(path, new Blob(['overwrite']))).error
    ).not.toBeNull();
    for (const invalid of [
      '../outside',
      '/outside',
      'a/../../b',
      'a\\b',
      'C:/outside',
    ])
      expect(() => storagePath('problem-uploads', invalid)).toThrow();
    expect(() => storagePath('../outside', path)).toThrow();
    await store.remove([path]);
    expect((await store.download(path)).error).not.toBeNull();
  });
  it('uses hashed passwords, expires/revokes sessions, and throttles failed logins', () => {
    const salt = randomBytes(16).toString('hex'),
      password = 'test-only-password';
    database()
      .prepare('INSERT OR REPLACE INTO settings VALUES (?,?)')
      .run(
        'password',
        `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
      );
    expect(() => login('wrong')).toThrow();
    const token = login(password);
    expect(validSession(token)).toBe(true);
    expect(validSession('invalid')).toBe(false);
    logout(token);
    expect(validSession(token)).toBe(false);
    const expired = login(password);
    database().prepare('UPDATE sessions SET expires_at=0').run();
    expect(validSession(expired)).toBe(false);
    for (let i = 0; i < 10; i++) expect(() => login('wrong')).toThrow();
    expect(() => login(password)).toThrow('尝试次数过多');
  });
});
