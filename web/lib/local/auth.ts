import {
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';
import { database, OWNER_ID } from './database';

export const SESSION_COOKIE = 'wqn_session';
export const OWNER = {
  id: OWNER_ID,
  email: 'owner@localhost',
  role: 'authenticated',
  aud: 'authenticated',
  app_metadata: {},
  user_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
};
const digest = (token: string) =>
  createHash('sha256').update(token).digest('hex');

export function passwordConfigured() {
  return !!database()
    .prepare("SELECT value FROM settings WHERE key='password'")
    .get();
}
export function validSession(token?: string) {
  if (!token || token.length !== 64) return false;
  return !!database()
    .prepare(
      'SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?'
    )
    .get(digest(token), Date.now());
}
export function login(password: string) {
  return (() => {
    const db = database();
    const throttle = db.prepare('SELECT * FROM auth_throttle WHERE id=1').get();
    if (Number(throttle?.blocked_until || 0) > Date.now())
      throw new Error('尝试次数过多，请 15 分钟后重试');
    const stored = db
      .prepare("SELECT value FROM settings WHERE key='password'")
      .get();
    if (!stored) throw new Error('请先在服务器运行 npm run setup 设置个人密码');
    const [salt, expected] = String(stored.value).split(':');
    const actual = scryptSync(password, salt, 64);
    if (!timingSafeEqual(actual, Buffer.from(expected, 'hex'))) {
      const failures = Number(throttle?.failures || 0) + 1;
      db.prepare('INSERT OR REPLACE INTO auth_throttle VALUES (1, ?, ?)').run(
        failures,
        failures >= 10 ? Date.now() + 900000 : 0
      );
      throw new Error('密码不正确');
    }
    db.prepare('DELETE FROM auth_throttle').run();
    db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
    const token = randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES (?, ?)').run(
      digest(token),
      Date.now() + 30 * 86400000
    );
    return token;
  })();
}
export function logout(token?: string) {
  if (token)
    database()
      .prepare('DELETE FROM sessions WHERE token_hash=?')
      .run(digest(token));
}
