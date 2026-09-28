# menu-data

移动端优先的配菜管理 PWA，包含菜品、配料、配方、订单、加菜和按日期采购汇总。

- 前端：GitHub Pages
- API：Cloudflare Worker
- 数据：GitHub 私有仓库中的 `data.json`
- 数据库：不使用

日常使用方法见 [操作手册](./操作手册.md)。

## 本地运行

```bash
npm install
npm run dev
```

本地默认使用浏览器 `localStorage`，不会请求 Worker 或 GitHub。

## 1. 创建私有数据仓库

创建 GitHub 私有仓库 `menu-data-store`，在默认分支 `main` 的根目录添加 `data.json`：

```json
{
  "schema_version": 1,
  "dishes": [],
  "ingredients": [],
  "recipes": [],
  "orders": []
}
```

创建 Fine-grained Personal Access Token：

- Repository access：只选择 `menu-data-store`
- Repository permissions → Contents：`Read and write`
- 不需要给 `menu-data` 源码仓库权限

## 2. 部署 Cloudflare Worker

Worker 代码位于 `worker/`。

```bash
cd worker
npm install
npx wrangler login
npm run deploy
```

`worker/wrangler.jsonc` 中的普通变量：

| 变量 | 值 |
| --- | --- |
| `GITHUB_OWNER` | `jiaovlog` |
| `GITHUB_REPO` | `menu-data-store` |
| `GITHUB_BRANCH` | `main` |
| `ALLOWED_ORIGIN` | `https://jiaovlog.github.io` |

机密信息必须使用 Wrangler Secret 或 Cloudflare 控制台的加密变量，不能写入仓库：

```bash
npx wrangler secret put GITHUB_TOKEN
npx wrangler secret put APP_ACCESS_KEY
```

部署成功后会得到类似地址：

```text
https://menu-data-api.<账号>.workers.dev/api/data
```

直接打开接口显示“访问密钥不正确”是正常的，说明 Worker 已运行且没有泄露数据。

### GitHub 404 排查

Worker 显示“GitHub 找不到 data.json”时，依次确认：

1. `GITHUB_OWNER` 是仓库所有者登录名，不是昵称。
2. `GITHUB_REPO` 是 `menu-data-store`，没有空格和 `.git`。
3. `GITHUB_BRANCH` 与数据仓库默认分支一致。
4. `data.json` 位于仓库根目录，文件名大小写完全一致。
5. Fine-grained Token 已选择该私有仓库并具有 `Contents: Read and write`。

私有仓库不存在和 Token 无权限都会被 GitHub 隐藏为 `404 Not Found`。

## 3. 配置 GitHub Pages

在 `jiaovlog/menu-data` 打开：

```text
Settings → Secrets and variables → Actions → Variables
```

新增仓库变量：

```text
VITE_API_URL=https://你的Worker域名/api/data
```

这里只填写 Worker URL，不要在 GitHub Pages 仓库中添加 `GITHUB_TOKEN` 或 `APP_ACCESS_KEY`。

然后在：

```text
Settings → Pages → Build and deployment → Source
```

选择 `GitHub Actions`。

推送到 `main` 后，[部署工作流](./.github/workflows/static.yml)会自动执行：

1. 安装依赖。
2. 执行测试。
3. 使用远程模式和 `/menu-data/` 基础路径构建。
4. 只把 `dist` 发布到 GitHub Pages。

## 4. 手机连接

1. 打开 <https://jiaovlog.github.io/menu-data/>。
2. 进入“数据与设置”。
3. 输入 Worker 中设置的 `APP_ACCESS_KEY`。
4. 点击“保存并刷新”。

两台手机输入相同的访问密钥后，会共同读写私有仓库中的 `data.json`。

## 安全说明

- `GITHUB_TOKEN` 只保存在 Cloudflare Worker Secrets。
- `APP_ACCESS_KEY` 只保存在 Worker Secrets 和两台手机中。
- Worker 仅允许来自 `https://jiaovlog.github.io` 的浏览器跨域请求。
- 保存使用 GitHub 文件 SHA 检测并发冲突，不会静默覆盖另一台手机的修改。
- API 请求和响应不进入 PWA 缓存。
- 每次保存都会在私有数据仓库产生 Git 提交，删除的数据仍可能存在于 Git 历史中。

## 验证

```bash
npm test
npm run build
```

模拟 GitHub Pages 构建：

```powershell
$env:VITE_DATA_MODE='remote'
$env:VITE_BASE_PATH='/menu-data/'
$env:VITE_API_URL='https://example.workers.dev/api/data'
npm run build
```
