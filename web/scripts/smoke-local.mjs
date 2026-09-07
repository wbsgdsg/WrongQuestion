// Runs against the local development server using a short-lived test session.
// Requires filesystem access to the same data directory; never exposes a login bypass over HTTP.
import { DatabaseSync } from 'node:sqlite';
import { resolve } from 'node:path';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
try {
  process.loadEnvFile('.env.local');
} catch {}
const base = 'http://localhost:3000';
const db = new DatabaseSync(
  resolve(process.env.WQN_DATA_DIR || './data', 'notebook.sqlite')
);
const token = randomBytes(32).toString('hex');
const hash = createHash('sha256').update(token).digest('hex');
db.prepare('INSERT INTO sessions VALUES (?,?)').run(
  hash,
  Date.now() + 30 * 60000
);
const headers = { cookie: `wqn_session=${token}` };
let subject, filePath;
async function api(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    headers: {
      ...headers,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120000),
  });
  const result = await response.json();
  assert.ok(
    response.ok,
    `${method} ${path}: ${response.status} ${JSON.stringify(result)}`
  );
  return result.data ?? result;
}
try {
  assert.equal((await fetch(base + '/api/subjects')).status, 401);
  subject = await api('/api/subjects', 'POST', {
    name: '自动测试（完成后删除）',
  });
  const tag = await api('/api/tags', 'POST', {
    subject_id: subject.id,
    name: '测试标签',
  });
  const id = randomUUID();
  filePath = `user/00000000-0000-4000-8000-000000000001/problems/${id}/problem/test.pdf`;
  const form = new FormData();
  form.set(
    'file',
    new Blob(['%PDF-1.4 test'], { type: 'application/pdf' }),
    'test.pdf'
  );
  form.set('bucket', 'problem-uploads');
  form.set('path', filePath);
  const upload = await fetch(base + '/api/local/files', {
    method: 'POST',
    headers,
    body: form,
  });
  assert.equal(upload.status, 201, await upload.text());
  const problem = await api('/api/problems', 'POST', {
    id,
    subject_id: subject.id,
    title: '测试方程',
    content: '<p>x + 2 = 3</p>',
    problem_type: 'short',
    correct_answer: '1',
    tag_ids: [tag.id],
    assets: [{ path: filePath, kind: 'pdf' }],
  });
  assert.equal(problem.tags[0].name, '测试标签');
  console.log('PASS notebook, tag, attachment and problem creation');
  await api(`/api/problems/${id}`, 'PATCH', {
    title: '修改后的方程',
    content: '<p>x + 3 = 4</p>',
  });
  const fetched = await api(`/api/problems/${id}`);
  assert.equal(fetched.title, '修改后的方程');
  assert.equal(
    (
      await api(
        `/api/problems?subject_id=${subject.id}&search_text=修改&search_title=true`
      )
    ).length,
    1
  );
  const file = await fetch(
    base + '/api/files/' + encodeURIComponent(filePath),
    { headers }
  );
  assert.equal(file.status, 200);
  assert.equal(await file.text(), '%PDF-1.4 test');
  assert.equal(
    (
      await fetch(
        base +
          '/api/local/files?bucket=problem-uploads&path=' +
          encodeURIComponent(filePath)
      )
    ).status,
    401
  );
  console.log('PASS edit, search, protected file download');
  const review = await api('/api/review-sessions/start-spaced', 'POST', {
    subject_id: subject.id,
  });
  assert.ok(review.sessionId);
  await api('/api/attempts', 'POST', {
    problem_id: id,
    submitted_answer: '1',
    is_correct: true,
    is_self_assessed: true,
    selected_status: 'mastered',
  });
  await api(`/api/review-sessions/${review.sessionId}/complete`, 'POST');
  assert.equal((await api(`/api/problems/${id}`)).status, 'mastered');
  const set = await api('/api/problem-sets', 'POST', {
    subject_id: subject.id,
    name: '测试题集',
    sharing_level: 'private',
    problem_ids: [id],
  });
  assert.ok(set.id);
  console.log('PASS review, answer, status and problem set');
  for (const page of [
    '/zh-CN/subjects',
    `/zh-CN/subjects/${subject.id}/problems`,
    `/zh-CN/subjects/${subject.id}/problems/${id}/review`,
    '/zh-CN/problem-sets',
    `/zh-CN/problem-sets/${set.id}`,
    '/zh-CN/statistics',
  ]) {
    const response = await fetch(base + page, {
      headers,
      signal: AbortSignal.timeout(180000),
    });
    const text = await response.text();
    assert.equal(response.status, 200, page);
    assert.ok(!text.includes('NEXT_HTTP_ERROR_FALLBACK;500'), page);
    console.log(
      `PASS page ${page.replaceAll(subject.id, ':subject').replaceAll(id, ':problem').replaceAll(set.id, ':set')}`
    );
  }
} finally {
  try {
    if (subject?.id) await api(`/api/subjects/${subject.id}`, 'DELETE');
  } finally {
    if (filePath)
      await api('/api/files/delete', 'DELETE', { path: filePath }).catch(
        () => {}
      );
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash);
    db.close();
  }
}
