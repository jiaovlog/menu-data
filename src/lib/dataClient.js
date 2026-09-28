import { DEMO_DATA } from './defaultData.js'

const DATA_KEY = 'menu-data:content:v1'
const ACCESS_KEY = 'menu-data:access-key'

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

export const dataMode = import.meta.env.VITE_DATA_MODE === 'remote' ? 'remote' : 'local'

export function getAccessKey() {
  return localStorage.getItem(ACCESS_KEY) || ''
}

export function setAccessKey(value) {
  localStorage.setItem(ACCESS_KEY, value.trim())
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

  const response = await fetch('/api/data', {
    headers: { 'X-App-Key': getAccessKey() }
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.message || '读取远程数据失败')
  return { data: validateData(payload.data), revision: payload.revision }
}

export async function saveData(data, revision) {
  validateData(data)
  if (dataMode === 'local') {
    localStorage.setItem(DATA_KEY, JSON.stringify(data))
    return { revision: `local-${Date.now()}` }
  }

  const response = await fetch('/api/data', {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'X-App-Key': getAccessKey()
    },
    body: JSON.stringify({ data, revision })
  })
  const payload = await response.json().catch(() => ({}))
  if (response.status === 409) {
    const error = new Error('数据已被另一台手机修改，请刷新后重试')
    error.code = 'CONFLICT'
    throw error
  }
  if (!response.ok) throw new Error(payload.message || '保存远程数据失败')
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
