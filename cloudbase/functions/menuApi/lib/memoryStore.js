'use strict'

/**
 * 文档型数据库的内存实现，接口与 CloudBase 文档数据库版一致。
 *
 * 用途：
 * - 本地开发（npm run dev）时充当云端文档数据库，配合云函数同一份 core.js 运行；
 * - 单元测试里验证保存/冲突/删除逻辑。
 *
 * state 结构（可直接 JSON 序列化落盘）：
 * { meta: { revision, lock_token, lock_at, ... } | null, collections: { 集合名: [文档] } }
 */

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function createMemoryStore(options = {}) {
  const state = options.state || { meta: null, collections: {} }
  state.collections = state.collections || {}
  const persist = typeof options.persist === 'function' ? options.persist : () => {}

  function bucket(name) {
    if (!Array.isArray(state.collections[name])) state.collections[name] = []
    return state.collections[name]
  }

  function commit() {
    persist(clone(state))
  }

  return {
    state,

    async ensureReady(names = []) {
      for (const name of names) bucket(name)
    },

    async readMeta() {
      return state.meta ? clone(state.meta) : null
    },

    async createMeta(meta) {
      if (state.meta) return false
      state.meta = clone(meta)
      commit()
      return true
    },

    async acquireLock(expectedToken, token, lockAt) {
      const meta = state.meta
      if (!meta) return false
      if (String(meta.lock_token || '') !== String(expectedToken || '')) return false
      meta.lock_token = token
      meta.lock_at = lockAt
      commit()
      return true
    },

    async releaseLock(token, patch) {
      const meta = state.meta
      if (!meta || String(meta.lock_token || '') !== String(token)) return false
      Object.assign(meta, clone(patch))
      commit()
      return true
    },

    async readCollection(name) {
      return clone(bucket(name))
    },

    async upsertDocs(name, entries) {
      const list = bucket(name)
      for (const entry of entries) {
        const document = entry.document || entry
        const index = list.findIndex((item) => item._id === document._id)
        if (index >= 0) list[index] = clone(document)
        else list.push(clone(document))
      }
      if (entries.length) commit()
    },

    async deleteByIds(name, ids) {
      if (!ids.length) return
      const removing = new Set(ids)
      state.collections[name] = bucket(name).filter((document) => !removing.has(document._id))
      commit()
    }
  }
}

module.exports = { createMemoryStore }
