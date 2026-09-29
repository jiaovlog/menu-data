#!/usr/bin/env node
/**
 * 手机端预览：用手机尺寸的窗口打开配菜管理页面（默认指向本地 dev server）。
 *
 * 用法：
 *   node scripts/preview-mobile.mjs                       # 用 390x844 的手机窗口打开 http://127.0.0.1:5173/
 *   node scripts/preview-mobile.mjs --url http://127.0.0.1:5173/ --width 414 --height 896
 *   node scripts/preview-mobile.mjs --shot .local/mobile.png --headless   # 无窗口截图，便于自动检查
 *
 * 说明：脚本通过 Chrome DevTools Protocol 打开设备模拟（移动端视口 + 触摸），
 * 所以窗口里看到的就是手机端真实布局（底部导航、单列卡片）。
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)

function readArg(name, fallback) {
  const index = args.indexOf(`--${name}`)
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1]
  return fallback
}

const hasFlag = (name) => args.includes(`--${name}`)
const url = readArg('url', process.env.PREVIEW_URL || 'http://127.0.0.1:5173/')
const width = Number(readArg('width', 390))
const height = Number(readArg('height', 844))
const port = Number(readArg('port', 9333))
const headless = hasFlag('headless')
const shot = readArg('shot', '')
const appKey = readArg('app-key', process.env.APP_ACCESS_KEY || '')
const mobileUserAgent =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'

const CANDIDATES = [
  process.env.BROWSER_PATH,
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
].filter(Boolean)

const browser = CANDIDATES.find((candidate) => existsSync(candidate))
if (!browser) {
  console.error('未找到 Edge/Chrome，可用 BROWSER_PATH 环境变量指定浏览器路径')
  process.exit(1)
}

function lanAddresses(port) {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => `http://${item.address}:${port}/`)
}

// 浏览器 profile 放在项目外的临时目录：放在项目里会被 Vite 文件监听锁定报错。
// 按端口区分，保证多个预览窗口（含无头截图）互不干扰。
const profileDir = path.join(os.tmpdir(), `menu-data-mobile-profile-${port}`)
mkdirSync(profileDir, { recursive: true })

const flags = [
  `--app=${url}`,
  `--user-data-dir=${profileDir}`,
  `--remote-debugging-port=${port}`,
  `--no-first-run`,
  `--no-default-browser-check`,
  `--disable-features=Translate,OptimizationHints`,
  `--window-size=${width},${height}`,
  '--window-position=60,60'
]
if (headless) flags.push('--headless=new', '--disable-gpu')

const child = spawn(browser, flags, { detached: !headless, stdio: 'ignore' })
if (!headless) child.unref()

async function waitForTarget(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`)
      const targets = await response.json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      // 浏览器还在启动
    }
    await new Promise((resolve) => setTimeout(resolve, 400))
  }
  throw new Error('等待浏览器调试端口超时')
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })

  let nextId = 0
  function send(method, params = {}) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      const onMessage = (event) => {
        const message = JSON.parse(event.data)
        if (message.id !== id) return
        socket.removeEventListener('message', onMessage)
        if (message.error) reject(new Error(`${method} 失败：${message.error.message}`))
        else resolve(message.result)
      }
      socket.addEventListener('message', onMessage)
      socket.send(JSON.stringify({ id, method, params }))
    })
  }

  return { send, close: () => socket.close() }
}

const target = await waitForTarget()
const client = await connect(target.webSocketDebuggerUrl)

await client.send('Page.enable')
await client.send('Emulation.setDeviceMetricsOverride', {
  width,
  height,
  deviceScaleFactor: 2,
  mobile: true,
  screenWidth: width,
  screenHeight: height
})
await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
await client.send('Emulation.setUserAgentOverride', { userAgent: mobileUserAgent, platform: 'Android' })

// --app-key 可以在页面加载前把访问密钥写进 localStorage，省去在手机窗口里手输
if (appKey) {
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `try { localStorage.setItem('menu-data:access-key', ${JSON.stringify(appKey)}) } catch (error) {}`
  })
}

await client.send('Page.navigate', { url })

const wait = Number(readArg('wait', 2500))
const clickText = readArg('click-text', '')
if (shot || hasFlag('click') || clickText) await new Promise((resolve) => setTimeout(resolve, wait))

// --click-text "确定访问"：按文字点按钮（例如 CloudBase 默认测试域名的访问提示页）。
// 用 CDP 派发真实鼠标事件，页面要求真实点击时也能生效。
if (clickText) {
  const located = await client.send('Runtime.evaluate', {
    expression: `(() => {
      const text = ${JSON.stringify(clickText)};
      const nodes = Array.from(document.querySelectorAll('button, a, div, span'));
      const node = nodes.find((item) => item.textContent.trim() === text) || nodes.find((item) => item.textContent.includes(text));
      if (!node) return null;
      const element = node.closest('button') || node.closest('a') || node;
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, tag: element.tagName, text: element.textContent.trim().slice(0, 20) };
    })()`,
    returnByValue: true
  })

  const point = located.result?.value
  if (!point) {
    console.log(`未找到文字「${clickText}」对应的元素`)
  } else {
    for (const type of ['mousePressed', 'mouseReleased']) {
      await client.send('Input.dispatchMouseEvent', {
        type,
        x: point.x,
        y: point.y,
        button: 'left',
        clickCount: 1,
        buttons: type === 'mousePressed' ? 1 : 0
      })
    }
    console.log(`点击「${clickText}」（${point.tag}）于 ${Math.round(point.x)},${Math.round(point.y)}`)
    await new Promise((resolve) => setTimeout(resolve, Number(readArg('wait-after-click', 4000))))
  }
}

// --click "#id" / ".selector"：截图前再点一下，例如切到某个页签
if (hasFlag('click')) {
  const selector = readArg('click', '')
  const result = await client.send('Runtime.evaluate', {
    expression: `(() => { const node = document.querySelector(${JSON.stringify(selector)}); if (!node) return 'not-found'; node.click(); return 'clicked' })()`,
    returnByValue: true
  })
  console.log(`点击 ${selector}：${result.result?.value}`)
  await new Promise((resolve) => setTimeout(resolve, 900))
}

if (shot) {
  const result = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
  const output = path.resolve(root, shot)
  mkdirSync(path.dirname(output), { recursive: true })
  writeFileSync(output, Buffer.from(result.data, 'base64'))
  console.log(`已保存手机端截图：${output}`)
}

console.log(`已在手机模拟视口（${width}x${height}，移动端 UA + 触摸）中打开：${url}`)
console.log(`浏览器：${browser}`)
for (const address of lanAddresses(5173)) {
  console.log(`同一 Wi-Fi 下手机可直接访问：${address}`)
}

client.close()
if (headless) child.kill()
else console.log('关闭这个手机尺寸的浏览器窗口即可结束预览（页面数据来自本地云函数模拟层）。')
