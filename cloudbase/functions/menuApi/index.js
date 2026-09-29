'use strict'

/**
 * 云函数入口：menuApi
 *
 * 支持两种调用方式：
 * 1. HTTP 访问服务（推荐给浏览器手机端使用）
 *    GET  <访问路径>  读取全部数据
 *    PUT  <访问路径>  保存全部数据（带 revision 乐观锁）
 *    两个请求都需要请求头 X-App-Key: <APP_ACCESS_KEY>
 * 2. 云函数直接调用（app.callFunction / 控制台测试）
 *    { action: 'load', appKey }
 *    { action: 'save', appKey, data, revision }
 *
 * 环境变量：
 * - APP_ACCESS_KEY  必填，前端访问密钥（云函数配置中设置，不要写进代码仓库）
 * - ALLOWED_ORIGIN  可选，允许跨域的来源，多个用英文逗号分隔；填 * 表示不限制
 * - CLOUDBASE_ENV_ID 可选，默认使用当前云函数所在环境
 */

const cloudbase = require('@cloudbase/node-sdk')
const { createHandler, safeEqual } = require('./lib/core.js')
const { createCloudbaseStore } = require('./lib/cloudbaseStore.js')

let cachedHandler = null

function getHandler() {
  if (!cachedHandler) {
    const app = cloudbase.init({
      env: process.env.CLOUDBASE_ENV_ID || cloudbase.SYMBOL_CURRENT_ENV
    })
    cachedHandler = createHandler({
      store: createCloudbaseStore({ db: app.database() }),
      config: () => ({
        appAccessKey: process.env.APP_ACCESS_KEY,
        allowedOrigins: process.env.ALLOWED_ORIGIN
      })
    })
  }
  return cachedHandler
}

function normalizeHeaders(headers) {
  const normalized = {}
  for (const [key, value] of Object.entries(headers || {})) {
    if (value === undefined || value === null) continue
    normalized[String(key).toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return normalized
}

function isHttpEvent(event) {
  return Boolean(event && (event.httpMethod || event.requestContext || event.headers))
}

function readBody(event) {
  if (typeof event?.body !== 'string') return ''
  if (event.isBase64Encoded) return Buffer.from(event.body, 'base64').toString('utf8')
  return event.body
}

async function handleDirectCall(event) {
  const appAccessKey = process.env.APP_ACCESS_KEY
  if (!appAccessKey) return { ok: false, message: '云函数环境变量 APP_ACCESS_KEY 未配置' }

  const api = getHandler()
  const action = String(event.action || 'load')

  if (action === 'load' || action === 'getData') {
    const result = await api.loadAll()
    return { ok: true, data: result.data, revision: result.revision }
  }

  if (!safeEqual(event.appKey || event.app_access_key, appAccessKey)) {
    return { ok: false, message: '访问密钥不正确' }
  }
  if (action !== 'save' && action !== 'saveData') return { ok: false, message: `不支持的操作：${action}` }

  const invalid = api.validateData(event.data)
  if (invalid) return { ok: false, message: invalid }

  try {
    const result = await api.save(event.data, event.revision)
    return { ok: true, revision: result.revision }
  } catch (error) {
    return { ok: false, message: error.message, code: error.code || 'ERROR' }
  }
}

exports.main = async (event = {}) => {
  if (!isHttpEvent(event)) {
    try {
      return await handleDirectCall(event)
    } catch (error) {
      console.error('[menuApi] 云函数调用失败', error)
      return { ok: false, message: error?.message || '云函数内部错误' }
    }
  }

  const result = await getHandler().handle({
    method: event.httpMethod || event.requestContext?.httpMethod || 'GET',
    path: event.path || event.requestContext?.path || '/',
    headers: normalizeHeaders(event.headers || event.requestContext?.headers),
    query: event.queryStringParameters || event.queryString || {},
    body: readBody(event)
  })

  return {
    statusCode: result.status,
    headers: result.headers,
    body: result.body === null ? '' : JSON.stringify(result.body),
    isBase64Encoded: false
  }
}
