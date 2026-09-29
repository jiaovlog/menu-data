#!/usr/bin/env node
/**
 * 一键部署到腾讯云 CloudBase：
 *   1. 部署云函数 menuApi（Nodejs18.15，自动创建 HTTP 访问路径 /menuApi）
 *   2. 用云函数实际访问地址构建前端
 *   3. 发布 dist 到静态网站托管
 *
 * 用法：
 *   node scripts/cloudbase-deploy.mjs --env-id <envId> [--app-key <访问密钥>] [--skip-build] [--skip-fn] [--skip-hosting]
 *   也可以用环境变量：TCB_ENV_ID / APP_ACCESS_KEY
 *
 * 注意：脚本会生成 cloudbaserc.deploy.json（已在 .gitignore 中），
 * 里面包含 APP_ACCESS_KEY，请勿提交到仓库。再次部署会沿用已有密钥。
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const isWindows = process.platform === 'win32'
const args = process.argv.slice(2)

function readArg(name, fallback = '') {
  const index = args.indexOf(`--${name}`)
  if (index >= 0 && args[index + 1] && !args[index + 1].startsWith('--')) return args[index + 1]
  return fallback
}

const hasFlag = (name) => args.includes(`--${name}`)
const envId = readArg('env-id', process.env.TCB_ENV_ID || process.env.VITE_TCB_ENV_ID || '')
const appKey = readArg('app-key', process.env.APP_ACCESS_KEY || '')
const servicePath = readArg('service-path', process.env.TCB_SERVICE_PATH || '/menuApi')
const explicitAllowedOrigin = readArg('allowed-origin', process.env.ALLOWED_ORIGIN || '')
const fnName = readArg('fn-name', 'menuApi')
const deployConfigFile = path.join(root, 'cloudbaserc.deploy.json')

if (!envId) {
  console.error('缺少环境 ID：请使用 --env-id <envId>，或设置环境变量 TCB_ENV_ID')
  process.exit(1)
}

const bin = (name) => (isWindows ? `${name}.cmd` : name)
const stripAnsi = (value) => String(value || '').replace(/\u001b\[[0-9;]*m/g, '')

function quoteArg(value) {
  const text = String(value)
  if (text === '') return '""'
  return /[\s"^&|<>()]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}

// Windows 上 tcb/npm 是 .cmd，只能通过 shell 调用；这里把整条命令拼成字符串再交给 shell，
// 避免 Node 在 shell + 参数数组组合下的兼容性问题。
function shellRun(command, extraArgs, options = {}) {
  const line = [command, ...extraArgs].map(quoteArg).join(' ')
  return spawnSync(line, {
    cwd: options.cwd || root,
    env: { ...process.env, ...(options.env || {}) },
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    shell: true,
    windowsHide: true
  })
}

function run(command, extraArgs, options = {}) {
  const printable = [command, ...extraArgs].join(' ')
  console.log(`\n$ ${printable}`)
  const result = shellRun(command, extraArgs, options)
  if (result.status !== 0) {
    console.error(`命令失败（exit ${result.status}）：${printable}`)
    if (result.stderr) console.error(stripAnsi(result.stderr).trim().slice(0, 800))
    process.exit(result.status || 1)
  }
  return result
}

function capture(command, extraArgs) {
  const result = shellRun(command, extraArgs, { capture: true })
  return { status: result.status, output: stripAnsi(`${result.stdout || ''}${result.stderr || ''}`) }
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return null
  }
}

function resolveCli() {
  const probe = capture(bin('tcb'), ['--version'])
  if (probe.status === 0) {
    console.log(`使用 CloudBase CLI：${probe.output.trim().split('\n')[0]}`)
    return { command: bin('tcb'), prefix: [] }
  }
  console.log('未找到全局 tcb 命令，改用 npx @cloudbase/cli')
  return { command: bin('npx'), prefix: ['--yes', '@cloudbase/cli'] }
}

function checkLogin(cli) {
  const result = capture(cli.command, [...cli.prefix, 'env', 'detail', '--env-id', envId, '--json'])
  if (result.status === 2) {
    console.error('\n还没有登录腾讯云：请先执行  tcb login  完成授权后重新运行本脚本。')
    process.exit(2)
  }
  if (result.status !== 0) {
    console.warn(`未能读取环境信息（exit ${result.status}）：${result.output.trim().slice(0, 400)}`)
    return
  }
  console.log(`环境校验通过：${envId}`)
}

function writeDeployConfig(allowedOrigin) {
  const base = readJson(path.join(root, 'cloudbaserc.json')) || { functionRoot: 'cloudbase/functions', functions: [] }
  const previous = readJson(deployConfigFile)
  const previousKey = previous?.functions?.find((fn) => fn.name === fnName)?.envVariables?.APP_ACCESS_KEY
  const key = appKey || previousKey || `menu-${crypto.randomBytes(8).toString('hex')}`

  base.envId = envId
  base.functions = (base.functions || []).map((fn) =>
    fn.name === fnName
      ? { ...fn, envVariables: { ...(fn.envVariables || {}), APP_ACCESS_KEY: key, ALLOWED_ORIGIN: allowedOrigin } }
      : fn
  )

  writeFileSync(deployConfigFile, `${JSON.stringify(base, null, 2)}\n`, 'utf8')
  return { key, reused: Boolean(previousKey && !appKey) }
}

function hostingDomain(cli) {
  const result = capture(cli.command, [...cli.prefix, 'hosting', 'detail', '--env-id', envId])
  const match = result.output.match(/Domain:\s*(https?:\/\/\S+)/)
  return match ? match[1].replace(/\/$/, '') : `https://${envId}.tcloudbaseapp.com`
}

const cli = resolveCli()
checkLogin(cli)

const site = hostingDomain(cli)
// 默认只允许静态托管域名跨域；换了自定义域名时用 --allowed-origin 覆盖
const allowedOrigin = explicitAllowedOrigin || site
const functionUrl = (process.env.VITE_API_URL || `https://${envId}.service.tcloudbase.com${servicePath}`).trim()
let accessKey = appKey

if (!hasFlag('skip-fn')) {
  const config = writeDeployConfig(allowedOrigin)
  accessKey = config.key
  console.log(`已生成部署配置：${path.relative(root, deployConfigFile)}${config.reused ? '（沿用已有 APP_ACCESS_KEY）' : ''}`)
  console.log(`跨域白名单 ALLOWED_ORIGIN=${allowedOrigin}`)
  run(cli.command, [
    ...cli.prefix,
    'fn',
    'deploy',
    fnName,
    '--env-id',
    envId,
    '--path',
    servicePath,
    '--force',
    '--config-file',
    deployConfigFile
  ])
}

if (!hasFlag('skip-build')) {
  run(bin('npm'), ['run', 'build'], {
    env: {
      VITE_DATA_MODE: 'cloud',
      VITE_TCB_ENV_ID: envId,
      VITE_TCB_SERVICE_PATH: servicePath,
      VITE_API_URL: functionUrl
    }
  })
}

if (!hasFlag('skip-hosting')) {
  run(cli.command, [...cli.prefix, 'hosting', 'deploy', 'dist', '--env-id', envId, '--entry', 'index.html'])
}

console.log('\n================ 部署完成 ================')
console.log(`云函数：${fnName}（运行时 Nodejs18.15，HTTP 访问路径 ${servicePath}）`)
console.log(`云函数接口：${functionUrl}`)
console.log(`手机访问地址：${site}`)
console.log(`跨域白名单：${allowedOrigin}`)
console.log(`访问密钥 APP_ACCESS_KEY：${accessKey || '（未修改，请沿用此前设置的密钥）'}`)
console.log('\n手机打开网站后：数据与设置 → 填写访问密钥 → 测试连接 → 保存并刷新。')
