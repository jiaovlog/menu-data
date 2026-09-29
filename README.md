# menu-data

移动端优先的配菜管理 PWA，包含菜品、配料、配方、订单、加菜和按日期采购汇总。

- 前端：Vite + Vue 3（PWA，可添加到手机主屏幕）
- 后端：腾讯云 CloudBase 云函数 `menuApi`（Node.js 18）
- 数据：CloudBase 文档型数据库（MongoDB 协议），一个实体一个文档
- 托管：CloudBase 静态网站托管（HTTPS，手机直接访问）

日常使用方法见 [操作手册](./操作手册.md)。

## 架构

```text
手机浏览器 / PWA
      │  GET / PUT  https://<envId>.service.tcloudbase.com/menuApi
      │  请求头 X-App-Key: <APP_ACCESS_KEY>
      ▼
云函数 menuApi（cloudbase/functions/menuApi）
      │  校验密钥 → 校验数据 → revision 乐观锁 → 按集合差量同步
      ▼
文档型数据库集合
  menu_dishes      一条菜品一个文档（_id = 菜品 id）
  menu_ingredients 一条配料一个文档（_id = 配料 id）
  menu_recipes     一条配方一个文档（_id = dish_id__ingredient_id）
  menu_orders      一张订单一个文档（_id = 订单 id，追加单是独立文档）
  menu_meta        单文档（_id = main）保存 revision、写锁与条目统计
```

前端只和云函数通信，不直连数据库；数据库集合权限建议保持“仅管理端可读写”。

## 本地运行

```bash
npm install
npm run dev
```

本地开发默认就是**云端模式**：`vite` 插件 [dev/cloudbaseLocalApi.js](./dev/cloudbaseLocalApi.js) 把
**同一份云函数代码**挂到 `/api/data`，数据库换成落盘在 `.local/menu-db.json` 的本地文档库
（首次启动自动写入示例数据）。这样不用云环境也能把整套流程跑通。

纯浏览器本机模式（只用 localStorage）：

```powershell
$env:VITE_DATA_MODE='local'; npm run dev
```

手机尺寸预览（Edge/Chrome 设备模拟，移动端视口 + 触摸）：

```bash
node scripts/preview-mobile.mjs                 # 打开 390x844 的手机窗口
node scripts/preview-mobile.mjs --headless --shot .local/mobile.png
```

同一 Wi-Fi 下也可以直接用手机浏览器打开终端里打印的 `http://<局域网IP>:5173/`。

本地接口自测：

```bash
curl http://127.0.0.1:5173/api/data -H "X-App-Key: local-dev-key"
```

## 部署到腾讯云 CloudBase

### 1. 准备环境

1. 在 [CloudBase 控制台](https://tcb.cloud.tencent.com/dev) 创建环境（按量计费或包月均可），记下 **环境 ID**（形如 `menu-data-1a2b3c`）。
2. 在“静态网站托管”里点击开通（CLI 不会自动开通，必须先开通一次）。
3. 安装 CLI 并登录：

```bash
npm install -g @cloudbase/cli
tcb login          # 设备码/扫码授权，手机或浏览器确认即可
```

### 2. 一键部署

```bash
npm run deploy -- --env-id <你的环境ID> --app-key <自定义访问密钥>
```

脚本 [scripts/cloudbase-deploy.mjs](./scripts/cloudbase-deploy.mjs) 会依次：

1. 以云端模式构建前端（自动写入 `VITE_TCB_ENV_ID`，接口地址即 `https://<envId>.service.tcloudbase.com/menuApi`）；
2. 部署云函数 `menuApi`，`--path /menuApi` 自动创建 HTTP 访问服务路径；
3. 把 `dist` 发布到静态网站托管。

部署结束会打印手机访问地址与访问密钥。分步执行：

```bash
npm run deploy:fn    -- --env-id <envId> --app-key <key>   # 只更新云函数
npm run deploy:web   -- --env-id <envId>                   # 只更新前端
```

### 3. 云函数配置

| 配置项 | 值 | 说明 |
| --- | --- | --- |
| 运行时 | `Nodejs18.15` | 见 [cloudbaserc.json](./cloudbaserc.json) |
| 入口 | `index.main` | |
| 环境变量 `APP_ACCESS_KEY` | 自定义访问密钥 | 前端“数据与设置”里要填同一个值；由部署脚本生成，不写入仓库 |
| 环境变量 `ALLOWED_ORIGIN` | 静态托管域名 | 允许跨域的来源，多个用英文逗号分隔，`*` 表示不限制；部署脚本默认取静态托管域名，换自定义域名时用 `--allowed-origin` 覆盖 |
| HTTP 访问路径 | `/menuApi` | 由 `tcb fn deploy --path` 创建 |

数据库集合（`menu_dishes` / `menu_ingredients` / `menu_recipes` / `menu_orders` / `menu_meta`）
在第一次请求时由云函数自动创建。确认方式：控制台 → 数据库，看到这 5 个集合即可。
建议把这 5 个集合的权限都设置为 **“仅管理端可读写”**（浏览器端不需要直接访问数据库）。

> 云函数依赖（`@cloudbase/node-sdk`）由云端按 `package.json` / `package-lock.json` 自动安装，
> 本地不需要 `node_modules` 也能部署和开发。想在本机获得编辑器补全时执行 `npm run fn:install`。

> 云函数属于普通（Event）云函数，通过 HTTP 访问服务暴露；密钥错误时接口返回
> `{"message":"访问密钥不正确"}`，不会泄露任何数据。

### 4. 手机连接

1. 手机浏览器打开静态托管域名（部署脚本会打印，形如 `https://<envId>-1497276981.tcloudbaseapp.com`）。
   第一次打开会看到腾讯云 CloudBase 的“页面访问提示”（默认测试域名提示），点一次 **确定访问** 即可，
   之后同一个浏览器不再出现。
2. 右上角齿轮 → “数据与设置”。
3. 填写 `APP_ACCESS_KEY` → 点“测试连接”确认 → “保存并刷新”。
4. 两台手机填同一个密钥，就会共同读写同一套云端数据。
5. 需要的话按“添加到主屏幕”安装成 PWA。

想在电脑上模拟手机查看线上站点：

```bash
node scripts/preview-mobile.mjs --url https://<envId>-xxxx.tcloudbaseapp.com/ --app-key <密钥>
```

`--app-key` 会在页面加载前把密钥写进 localStorage，省去在小窗口里手输。

## 并发与数据安全

- 保存采用 **revision 乐观锁**：客户端带上读取时的版本号，云函数在写入前比对，
  不一致直接返回 409，不会静默覆盖另一台手机的修改。
- 云函数在 `menu_meta` 上有一把 30 秒超时的写锁，避免两台设备同时写同一批集合；
  异常中断后锁会自动过期。
- 写入是**差量**的：只写内容发生变化的文档，未变化的实体不会重复写库。
- 每次保存会更新 `revision` 与 `updated_at`，可在“数据与设置”里看到当前云端版本号与条目数。
- 接口响应不进入 PWA 缓存（Workbox `NetworkOnly`），手机不会读到过期的配菜数据。
- 前端仍保留“导出备份 / 导入备份”，可随时导出 JSON 到本地。

## 目录结构

```text
cloudbase/
  functions/menuApi/     云函数源码（部署这个目录）
    index.js             入口：HTTP 访问服务 + 云函数直接调用
    lib/core.js          业务核心：校验、revision 乐观锁、按集合差量同步（云端/本地共用）
    lib/cloudbaseStore.js  CloudBase 文档型数据库实现（@cloudbase/node-sdk）
    lib/memoryStore.js   内存文档库实现（本地开发与单元测试）
    lib/core.test.js     单元测试
  local/fileStore.js     本地开发：内存文档库 + JSON 落盘
dev/cloudbaseLocalApi.js 把云函数挂到本地 /api 的 vite 插件
scripts/cloudbase-deploy.mjs  一键部署（构建 + 云函数 + 静态托管）
scripts/preview-mobile.mjs    手机尺寸浏览器预览
cloudbaserc.json         CloudBase 项目配置（不含密钥）
src/                     Vue 前端
```

## 验证

```bash
npm test        # 云函数核心逻辑 + 采购计算共 15 个用例
npm run build   # 前端构建
```

云函数侧用例覆盖：空库读取、鉴权 401、未配置密钥 500、保存与读回、文档型数据库按实体落库、
旧版本号 409 冲突、删除同步、写锁与锁过期、CORS 白名单、格式校验 400、超长请求 413、重复保存零写入。

## 常见问题

**打开页面提示“未配置云函数访问地址”**
构建时没有传 `VITE_TCB_ENV_ID` 或 `VITE_API_URL`，用 `npm run deploy` 重新构建部署。

**提示“访问密钥不正确”**
“数据与设置”里填的密钥和云函数环境变量 `APP_ACCESS_KEY` 不一致。可在控制台
云函数 → 配置 → 环境变量里查看或修改。

**提示“无法连接云函数”**
检查 HTTP 访问服务路径是否为 `/menuApi`、云函数是否部署成功（`tcb fn list`）、
手机上网络是否正常。

**提示“数据已被另一台设备修改”**
另一台手机先保存了新数据。点右上角刷新，确认最新数据后再操作。

**提示集合不存在 / 数据库报错**
首次请求会自动建集合；若权限或环境异常，可在控制台手动创建上面 5 个集合。

**手机上第一次打开出现“页面访问提示 / 仅限开发测试”**
这是 CloudBase 默认测试域名（`*.tcloudbaseapp.com`）的提示页，点“确定访问”即可正常使用。
要彻底去掉，可在控制台绑定自定义域名，或按提示页里的“我是开发者，如何去掉当前页面”设置。

**部署脚本报 `ECONNRESET` / exit 5**
上传过程中网络中断，直接重跑同一条命令即可（函数会被覆盖更新，密钥会沿用，不会变化）。

**旧方案（GitHub 私有仓库 `data.json` + Cloudflare Worker）**
已从仓库移除，改为本方案。历史数据用“导出备份”得到 JSON，在手机上“导入备份”即可迁移过来。
