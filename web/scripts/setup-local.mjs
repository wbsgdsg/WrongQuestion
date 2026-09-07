import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes, scryptSync } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

try {
  process.loadEnvFile('.env.local');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
let muted = false;
const output = new Writable({
  write(chunk, encoding, callback) {
    if (!muted) process.stdout.write(chunk, encoding);
    callback();
  },
});
const terminal = createInterface({
  input: process.stdin,
  output,
  terminal: true,
});
async function secret(prompt) {
  muted = false;
  const pending = terminal.question(prompt);
  muted = true;
  const answer = await pending;
  muted = false;
  process.stdout.write('\n');
  return answer;
}
try {
  const password = await secret(
    '设置个人访问密码（至少 10 位，输入不会显示）: '
  );
  const confirmation = await secret('再次输入密码: ');
  if (password.length < 10 || password.length > 256)
    throw new Error('密码长度需为 10～256 位');
  if (password !== confirmation) throw new Error('两次密码不一致');
  const directory = resolve(process.env.WQN_DATA_DIR || './data');
  mkdirSync(directory, { recursive: true });
  const db = new DatabaseSync(resolve(directory, 'notebook.sqlite'));
  db.exec(
    'PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)'
  );
  const salt = randomBytes(32).toString('hex');
  db.exec('BEGIN IMMEDIATE');
  db.prepare('INSERT OR REPLACE INTO settings VALUES (?, ?)').run(
    'password',
    `${salt}:${scryptSync(password, salt, 64).toString('hex')}`
  );
  db.exec('DELETE FROM sessions; COMMIT');
  db.close();
  console.log(
    '密码已保存，旧登录已退出。运行 npm run dev 后输入此密码即可使用。'
  );
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  terminal.close();
}
