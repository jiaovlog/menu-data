# menu-data Cloudflare Worker

该 Worker 为 GitHub Pages 前端代理 GitHub Contents API，GitHub Token 不会发送到浏览器。

## 环境变量

普通变量在 `wrangler.jsonc` 中配置：

```text
GITHUB_OWNER=jiaovlog
GITHUB_REPO=menu-data-store
GITHUB_BRANCH=main
ALLOWED_ORIGIN=https://jiaovlog.github.io
```

机密变量通过命令设置：

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put APP_ACCESS_KEY
```

## 部署

```bash
npm install
npx wrangler login
npm run deploy
```

将最终的 `/api/data` 地址配置到 `menu-data` 仓库的 Actions Variable `VITE_API_URL`。

不要提交 `.dev.vars`、GitHub Token 或 APP_ACCESS_KEY。
