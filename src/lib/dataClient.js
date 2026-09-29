import { DEMO_DATA } from './defaultData.js'

const DATA_KEY = 'menu-data:content:v1'
const ACCESS_KEY = 'menu-data:access-key'
const DEV_APP_KEY = import.meta.env.VITE_DEV_APP_KEY?.trim() || 'local-dev-key'

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function validateData(data) {
  if (!data || typeof data !== 'object') throw new Error('数据格式无效')
  for (const key of ['dishes', 'ingredients', 'recipes', 'orders']) {
    if (!Array.isArray(data[key])) throw new Error(`数据缺少 ${key} 列表`)
  }
  return data
}

/** local: 只用浏览器 localStorage；cloud: 走腾讯云 CloudBase 云函数 + 文档型数据库 */
export const dataMode = import.meta.env.VITE_DATA_MODE === 'local' ? 'local' : 'cloud'
export const cloudEnvId = import.meta.env.VITE_TCB_ENV_ID?.trim() || ''

function resolveEndpoint() {
  const explicit = import.meta.env.VITE_API_URL?.trim()
  if (explicit) return explicit
  // 本地开发：由 vite 插件 dev/cloudbaseLocalApi.js 提供同款云函数接口
  if (import.meta.env.DEV) return '/api/data'
  if (cloudEnvId) {
    const raw = import.meta.env.VITE_TCB_SERVICE_PATH?.trim() || '/menuApi'
    return `https://${cloudEnvId}.service.tcloudbase.com${raw.startsWith('/') ? raw : `/${raw}`}`
  }
  return ''
}

export const apiEndpoint = dataMode === 'cloud' ? resolveEndpoint() : ''

function endpoint() {
  if (!apiEndpoint) {
    throw new Error('未配置云函数访问地址：请在构建时设置 VITE_TCB_ENV_ID 或 VITE_API_URL')
  }
  return apiEndpoint
}

function accessKeyValue() {
  const stored = localStorage.getItem(ACCESS_KEY) || ''
  if (stored) return stored
  return import.meta.env.DEV ? DEV_APP_KEY : ''
}

export function getAccessKey() {
  return accessKeyValue()
}

export function setAccessKey(value) {
  localStorage.setItem(ACCESS_KEY, value.trim())
}

export function clearAccessKey() {
  localStorage.removeItem(ACCESS_KEY)
}

async function requestCloud(options = {}) {
  const url = endpoint()
  let response
  try {
    response = await fetch(url, {
      method: options.method || 'GET',
      headers: {
        'X-App-Key': accessKeyValue(),
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      },
      body: options.body
    })
  } catch (error) {
    throw new Error(`无法连接云函数（${url}）：${error.message}`)
  }

  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 401) throw new Error(payload.message || '访问密钥不正确')
    if (response.status === 409) {
      const error = new Error(payload.message || '数据已被另一台手机修改，请刷新后重试')
      error.code = 'CONFLICT'
      throw error
    }
    throw new Error(payload.message || `云函数请求失败（${response.status}）`)
  }
  return payload
}

export async function testConnection() {
  const payload = await requestCloud()
  return { revision: payload.revision, data: validateData(payload.data) }
}

export async function loadData() {
  if (dataMode === 'local') {
    const stored = localStorage.getItem(DATA_KEY)
    if (!stored) {
      const initial = clone(DEMO_DATA)
      localStorage.setItem(DATA_KEY, JSON.stringify(initial))
      return { data: initial, revision: 'local-1' }
    }
    return { data: validateData(JSON.parse(stored)), revision: `local-${Date.now()}` }
  }

  const payload = await requestCloud()
  return { data: validateData(payload.data), revision: payload.revision }
}

export async function saveData(data, revision) {
  validateData(data)
  if (dataMode === 'local') {
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
    return { revision: `local-${Date.now()}` }
  }

  const payload = await requestCloud({ method: 'PUT', body: JSON.stringify({ data, revision }) })
  return { revision: payload.revision }
}

export function downloadBackup(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `menu-data-${new Date().toISOString().slice(0, 10)}.json`
  anchor.click()
  URL.revokeObjectURL(url)
}

export async function parseBackup(file) {
  const text = await file.text()
  return validateData(JSON.parse(text))
}
