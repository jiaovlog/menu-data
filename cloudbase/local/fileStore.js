'use strict'

/**
 * 本地开发用的文档库：内存文档库 + JSON 文件持久化。
 *
 * 与云函数使用同一份 lib/core.js 业务逻辑，只是把 CloudBase 文档型数据库
 * 换成落盘到 .local/menu-db.json 的本地文档库，方便在没有云环境时开发调试。
 */

const fs = require('node:fs')
const path = require('node:path')
const { COLLECTIONS, toDocument } = require('../functions/menuApi/lib/core.js')
const { createMemoryStore } = require('../functions/menuApi/lib/memoryStore.js')

function buildSeedState(data, timestamp) {
  const now = new Date(timestamp).toISOString()
  const state = {
    meta: { revision: 1, lock_token: '', lock_at: 0, updated_at: now, counts: {} },
    collections: {}
  }

  for (const collection of COLLECTIONS) {
    const items = Array.isArray(data?.[collection.key]) ? data[collection.key] : []
    state.collections[collection.name] = items.map((item) => toDocument(collection, item, now))
    state.meta.counts[collection.key] = items.length
  }

  return state
}

function isEmptyState(state) {
  if (state?.meta) return false
  return Object.values(state?.collections || {}).every((list) => !Array.isArray(list) || list.length === 0)
}

function createFileStore({ file, seed = null, seedVersion = 1, log = console }) {
  const absolute = path.resolve(file)
  let state = null

  try {
    state = JSON.parse(fs.readFileSync(absolute, 'utf8'))
  } catch {
    state = null
  }

  if (!state || typeof state !== 'object') state = { meta: null, collections: {} }

  if (seed && isEmptyState(state)) {
    state = buildSeedState(seed, Date.now())
    log.info?.(`[menuApi] 本地文档库已用示例数据初始化：${absolute}`)
  }

  const store = createMemoryStore({
    state,
    persist: (next) => {
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    }
  })

  return {
    ...store,
    seedVersion,
    file: absolute,
    reset() {
      state = buildSeedState(seed, Date.now())
      store.state.meta = state.meta
      store.state.collections = state.collections
      fs.mkdirSync(path.dirname(absolute), { recursive: true })
      fs.writeFileSync(absolute, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
    }
  }
}

module.exports = { buildSeedState, createFileStore }
