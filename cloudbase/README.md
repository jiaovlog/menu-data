# 云函数 menuApi

menu-data 的后端：腾讯云 CloudBase 云函数 + 文档型数据库。

## 接口

需要请求头 `X-App-Key: <APP_ACCESS_KEY>`。

| 方法 | 路径 | 说明 | 响应 |
| --- | --- | --- | --- |
| GET | `/menuApi` | 读取全部数据 | `{ data, revision, updated_at }` |
| PUT | `/menuApi` | 保存全部数据 | `{ ok: true, revision }` |
| OPTIONS | `/menuApi` | CORS 预检 | `204` |

PUT 请求体：`{ data: { schema_version, dishes, ingredients, recipes, orders }, revision }`

错误码：

| 状态 | 含义 |
| --- | --- |
| 400 | 数据格式错误（缺少列表、字段类型不对、主键重复） |
| 401 | `X-App-Key` 不正确 |
| 409 | 版本号不是最新（另一台设备已保存），或写锁未释放 |
| 413 | 请求体超过 1 MB |
| 500 | 未配置 `APP_ACCESS_KEY` 或数据库异常 |

也可以不走 HTTP，直接用云函数调用（控制台测试 / `app.callFunction`）：

```json
{ "action": "load", "appKey": "<APP_ACCESS_KEY>" }
{ "action": "save", "appKey": "<APP_ACCESS_KEY>", "data": { ... }, "revision": 3 }
```

## 环境变量

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `APP_ACCESS_KEY` | 是 | 前端访问密钥，前后端必须一致 |
| `ALLOWED_ORIGIN` | 否 | 允许的跨域来源，逗号分隔，`*` 表示不限制；同源或原生请求不受影响 |
| `CLOUDBASE_ENV_ID` | 否 | 默认使用当前函数所在环境 |

## 集合

| 集合 | 主键 `_id` | 说明 |
| --- | --- | --- |
| `menu_dishes` | 菜品 id | `{ name, price, active }` |
| `menu_ingredients` | 配料 id | `{ name, unit, discrete }` |
| `menu_recipes` | `dish_id__ingredient_id` | `{ dish_id, ingredient_id, qty, unit? }` |
| `menu_orders` | 订单 id | `{ name, date, tables, status, created_at, parent_order_id?, items[] }` |
| `menu_meta` | `main` | `{ revision, lock_token, lock_at, updated_at, counts }` |

集合在第一次请求时自动创建（`db.createCollection`）。每个文档额外保存 `updated_at`，
读接口不会把 `_id` 和 `updated_at` 暴露给前端。

## 一次保存发生了什么

1. `menu_meta` 上的写锁用条件更新抢占（30 秒超时，异常中断后自动失效）；
2. 比对客户端 `revision` 与云端 `revision`，不一致返回 409；
3. 逐个集合读取现有文档，计算差量：内容变化的 `doc().set()`，被删除的 `where(_id in [...]).remove()`；
4. 释放写锁并把 `revision` 加一，返回给前端。

没有变化的文档不会被写库，所以“保存一次”通常只有几个文档真正落库。

## 本地开发

本地开发不连云环境：`vite` 插件 `dev/cloudbaseLocalApi.js` 加载这里的 `lib/core.js`，
把 store 换成 `cloudbase/local/fileStore.js`（落盘 `.local/menu-db.json`），HTTP 路径为 `/api/data`。

```bash
npm test                 # 单元测试（含 12 个云函数用例）
npm run deploy -- --env-id <envId> --app-key <key>
```
