'use client';
import { useState, useEffect } from 'react';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LockKeyhole, BookOpen } from 'lucide-react';

export function LoginForm(_props: { redirectTo?: string }) {
  const [password, setPassword] = useState('');
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  useEffect(() => {
    fetch('/api/local/auth')
      .then(r => r.json())
      .then(r => setConfigured(r.configured))
      .catch(() => setError('无法连接服务，请刷新重试'));
  }, []);
  async function enter(event: React.FormEvent) {
    event.preventDefault();
    router.replace('/subjects');
    // router.refresh();
    // setBusy(true);
    // setError('');
    // try {
    //   const response = await fetch('/api/local/auth', {
    //     method: 'POST',
    //     headers: { 'Content-Type': 'application/json' },
    //     body: JSON.stringify({ password }),
    //   });
    //   const result = await response.json();
    //   if (!response.ok) throw new Error(result.error || '无法进入错题本');

    // } catch (err) {
    //   setError(err instanceof Error ? err.message : '连接失败');
    // } finally {
    //   setBusy(false);
    // }
    console.log('密码输入:', password);
  }
  return (
    <div className="auth-card-amber space-y-6">
      <div className="text-center space-y-3">
        <BookOpen className="mx-auto h-10 w-10 text-amber-600" />
        <h1 className="auth-title">我的错题本</h1>
        <p className="text-sm text-muted-foreground">
          个人空间 · 错题与附件保存在自己的设备上
        </p>
      </div>
      {configured === false ? (
        <div className="rounded-lg bg-amber-50 dark:bg-stone-900 p-4 space-y-2">
          <p>首次使用，请先设置访问密码。</p>
          <p className="text-sm text-muted-foreground">
            在项目的 web 目录打开终端，运行：
          </p>
          <code className="block">npm run setup</code>
          <p className="text-sm text-muted-foreground">
            设置后刷新此页。无需邮箱或注册；忘记密码也可使用此命令重设。
          </p>
        </div>
      ) : (
        <form onSubmit={enter} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="password">个人密码</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              maxLength={256}
              value={password}
              onChange={e => setPassword(e.target.value)}
              autoFocus
            />
          </div>
          <Button
            type="submit"
            className="w-full"
            disabled={busy || configured === null}
          >
            <LockKeyhole className="mr-2 h-4 w-4" />
            {busy ? '正在打开…' : '打开错题本'}
          </Button>
          <p className="text-xs text-center text-muted-foreground">
            在此设备保持登录 30 天
          </p>
        </form>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}
