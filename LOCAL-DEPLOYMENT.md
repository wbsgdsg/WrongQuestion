# 个人服务器版

此版本使用 **SQLite + 磁盘附件 + 单个访问密码**，不需要 Supabase、邮箱注册或验证码。保留笔记本、富文本错题、图片/PDF 附件、标签、题集、作答、间隔复习和统计。公开发现、共享、用户管理、二维码跨设备上传和 AI 学习洞察不属于个人版；AI 图片提题可以单独配置 Gemini 密钥。

## 先在 Windows 本地运行

需要 Node.js 24 或更高版本。PowerShell 中执行：

```powershell
cd D:\Server_Project\WrongQuestion\web
npm install
# 仅在还没有 .env.local 时复制，已有文件不要覆盖
Copy-Item env.example .env.local
npm run setup
npm run dev
```

`npm run setup` 会要求输入两次密码，输入不会显示。密码至少 10 位，只保存加盐哈希。打开 http://localhost:3000 ，输入密码即可进入，登录保持 30 天。忘记密码时重新运行 `npm run setup`；旧会话失效，错题不会丢失。不需要填写 Supabase 相关变量，旧变量不再使用。

## Linux 服务器部署

将代码上传到服务器，进入 `web`，安装 Node.js 24 后执行：

```bash
npm ci
cp env.example .env.local
# 修改 SITE_URL 为自己的完整站点地址，例如 https://notes.example.com
# 设置 WQN_DATA_DIR 为持久目录的绝对路径，例如 /srv/wqn-data
# 该目录必须允许运行网站的系统用户读写
npm run setup
npm run build
npm start -- --hostname 127.0.0.1
```

通过 Nginx/Caddy 将自己的 HTTPS 域名反向代理到 `127.0.0.1:3000`。`SITE_URL` 必须与浏览器访问地址一致；配置为 HTTPS 时使用 Secure 会话 Cookie。生产服务用 systemd 托管，设置 `WorkingDirectory` 到 `web`、`ExecStart` 到实际的 npm 路径及 `start -- --hostname 127.0.0.1`，并设置 `Restart=on-failure`。不要使用 GitHub Pages 或临时/只读磁盘托管此版本。

示例 `/etc/systemd/system/wqn.service`（替换路径和用户）：

```ini
[Unit]
Description=Personal wrong question notebook
After=network.target

[Service]
User=wqn
WorkingDirectory=/srv/WrongQuestion/web
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start -- --hostname 127.0.0.1
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

安装好代码、配置和密码后运行 `sudo systemctl daemon-reload`、`sudo systemctl enable --now wqn`。用 `journalctl -u wqn -f` 查看运行日志。以上为部署文件与步骤，尚未替你购买或部署服务器。

## 数据保存、备份和迁移

默认保存位置（相对于 `web`）：

```text
data/
  notebook.sqlite       错题、标签、复习、个人设置、密码哈希和会话
  notebook.sqlite-wal   SQLite 运行时文件（可能存在）
  notebook.sqlite-shm   SQLite 运行时文件（可能存在）
  uploads/              图片和 PDF 附件
```

最简单可靠的备份：**停止网站进程，再复制整个 data 目录**。恢复时同样先停止服务，将备份恢复到 `WQN_DATA_DIR` 指定目录，再启动。不应在运行时只复制 `notebook.sqlite` 而遗漏 WAL。搬家时同时迁移数据库和附件；不要将 data 或 `.env.local` 提交到 GitHub。默认 data 已加入 Git 忽略，若使用自定义目录请自行保护。

更新代码不需要重新建表，首次启动会自动初始化。不要删除 data，不要对它运行清理构建产物的命令。SQLite 适合这里的单用户、单台服务器场景，多个网站副本不应通过网络盘共享此文件。

## 验证

```bash
npm run type-check
npm test
npm run build
```

开发服务运行时可以在另一个终端执行 `node scripts/smoke-local.mjs`。它仅连接本机 3000 端口，通过同一数据库建立短期测试会话，验证笔记本、题目、附件、复习和页面，结束后删除自己创建的测试数据与会话。测试不修改个人密码。
