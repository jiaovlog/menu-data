# menu-data

移动端优先的配菜管理 PWA，包含菜品、配料、配方、订单、加菜和按日期采购汇总。默认使用浏览器本地存储，部署后可通过 EdgeOne Pages 边缘函数把 JSON 文件同步到两台手机。

日常使用方法见 [操作手册](./操作手册.md)。

## 本地运行

```bash
npm install
npm run dev
```

默认访问 `http://127.0.0.1:5173/`。本地模式不请求任何远程服务，数据保存在当前浏览器的 `localStorage` 中，可在“数据与设置”中导入或导出 JSON 备份。

## 远程同步

1. 单独创建一个 Gitee 私有数据仓库，例如 `menu-data-store`，将 `data.example.json` 重命名为 `data.json` 后提交。
2. 在 EdgeOne Pages 中部署本项目，并配置下列服务端环境变量。
3. 将 `.env.example` 中的 `VITE_DATA_MODE` 改为 `remote`，重新构建部署。
4. 两台手机首次打开时，在“数据与设置”中输入相同的访问密钥。

| 环境变量 | 用途 |
| --- | --- |
| `GITEE_TOKEN` | Gitee 私人令牌，仅保存在边缘函数环境中 |
| `GITEE_OWNER` | 数据仓库所有者 |
| `GITEE_REPO` | 数据仓库名，建议为 `menu-data-store` |
| `APP_ACCESS_KEY` | 两台手机共用的高强度访问密钥 |

源码仓库和数据仓库建议分开。若 EdgeOne 关联的源码仓库同时存放运行时 `data.json`，每次保存数据产生的提交都可能触发一次重新构建。

## 相比原文档的修正

- 保存请求携带客户端读取时获得的 `revision`（Gitee SHA），由 Gitee 原子校验；版本过期返回 `409`，不会静默覆盖另一台手机的修改。
- 边缘函数使用请求头传递 Gitee Token，并透传上游失败状态，不再把失败统一包装成 HTTP 200。
- `/api/data` 必须校验 `APP_ACCESS_KEY`，避免任何知道部署地址的人都能改数据。
- Service Worker 不缓存 `/api/`，防止离线缓存返回过期订单数据。
- 已采购或已结算订单的加菜自动创建追加单；未结算订单则直接追加明细。
- 增加数据格式版本、JSON 备份导入导出、删除引用保护和完整 PWA 图标。

访问密钥只能阻止未授权调用，并不能让前端设备上的密钥不可见。个人或家庭低频使用足够；如需多人账号、精细权限或审计，应改用正式身份认证服务。

## 验证

```bash
npm test
npm run build
```
