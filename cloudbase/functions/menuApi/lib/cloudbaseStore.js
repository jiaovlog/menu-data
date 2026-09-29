'use strict'

/**
 * 腾讯云 CloudBase 文档型数据库（MongoDB 协议）实现。
 *
 * 依赖 @cloudbase/node-sdk，只在云函数环境中加载；
 * 本地开发使用 lib/memoryStore.js，云函数和本地共用 lib/core.js 业务逻辑。
 *
 * 集合设计：
 * - menu_meta        单文档（_id = main）保存 revision、写锁和统计
 * - menu_dishes      一条菜品一个文档（_id = 菜品 id）
 * - menu_ingredients 一条配料一个文档（_id = 配料 id）
 * - menu_recipes     一条配方一个文档（_id = dish_id__ingredient_id）
 * - menu_orders      一张订单一个文档（_id = 订单 id）
 */

const PAGE_SIZE = 500
const MAX_DOCS = 5000
const DELETE_CHUNK = 50
const META_COLLECTION = 'menu_meta'
const META_DOC_ID = 'main'

function isAlreadyExists(error) {
  const code = String(error?.code || error?.errCode || '')
  const message = String(error?.message || '')
  return (
    code === 'DATABASE_COLLECTION_EXIST' ||
    code === '-501001' ||
    code === '-502002' ||
    /already exists|already exist|已存在|collection.*exist/i.test(message)
  )
}

function isDuplicateKey(error) {
  const code = String(error?.code || error?.errCode || '')
  const message = String(error?.message || '')
  return code === 'DATABASE_DUPLICATE_KEY' || code === '11000' || /duplicate key|_id.*exist|已存在/i.test(message)
}

function isDocumentMissing(error) {
  const code = String(error?.code || error?.errCode || '')
  const message = String(error?.message || '')
  return (
    code === 'DATABASE_DOCUMENT_NOT_EXIST' ||
    code === 'DATABASE_COLLECTION_NOT_EXIST' ||
    code === '-502004' ||
    code === '-502005' ||
    /document.*not.*exist|collection.*not.*exist|not found|不存在/i.test(message)
  )
}

function firstDocument(result) {
  const data = result?.data
  if (Array.isArray(data)) return data[0] || null
  return data && typeof data === 'object' ? data : null
}

function chunk(list, size) {
  const chunks = []
  for (let index = 0; index < list.length; index += size) chunks.push(list.slice(index, index + size))
  return chunks
}

function createCloudbaseStore({ db, log = console }) {
  if (!db) throw new Error('createCloudbaseStore 需要传入 db')

  const command = db.command
  const meta = () => db.collection(META_COLLECTION)

  return {
    async ensureReady(names = []) {
      for (const name of names) {
        try {
          await db.createCollection(name)
        } catch (error) {
          if (!isAlreadyExists(error)) {
            log.warn?.(`[menuApi] 创建集合 ${name} 失败（可忽略，若后续读写报错请在控制台手动创建）：${error?.message || error}`)
          }
        }
      }
    },

    async readMeta() {
      try {
        const result = await meta().doc(META_DOC_ID).get()
        return firstDocument(result)
      } catch (error) {
        if (isDocumentMissing(error)) return null
        throw error
      }
    },

    async createMeta(document) {
      try {
        await meta().add({ _id: META_DOC_ID, ...document })
        return true
      } catch (error) {
        if (isDuplicateKey(error) || isAlreadyExists(error)) return false
        throw error
      }
    },

    async acquireLock(expectedToken, token, lockAt) {
      const result = await meta()
        .where({ _id: META_DOC_ID, lock_token: String(expectedToken || '') })
        .update({ lock_token: token, lock_at: lockAt })
      return Number(result?.updated || 0) > 0
    },

    async releaseLock(token, patch) {
      const result = await meta()
        .where({ _id: META_DOC_ID, lock_token: String(token) })
        .update(patch)
      return Number(result?.updated || 0) > 0
    },

    async readCollection(name) {
      const documents = []
      let offset = 0
      for (;;) {
        const result = await db.collection(name).skip(offset).limit(PAGE_SIZE).get()
        const batch = Array.isArray(result?.data) ? result.data : []
        documents.push(...batch)
        if (batch.length < PAGE_SIZE) break
        offset += batch.length
        if (documents.length >= MAX_DOCS) throw new Error(`集合 ${name} 文档数量超过 ${MAX_DOCS} 上限`)
      }
      return documents
    },

    async upsertDocs(name, entries) {
      for (const entry of entries) {
        const document = entry.document || entry
        // _id 由文档路径决定，CloudBase 不允许在写入内容里再带 _id
        const { _id, ...payload } = document
        if (entry.exists) {
          await db.collection(name).doc(_id).set(payload)
          continue
        }
        try {
          await db.collection(name).add({ _id, ...payload })
        } catch (error) {
          // 读取与写入之间被其它设备抢先创建时按更新处理
          if (isDuplicateKey(error)) await db.collection(name).doc(_id).set(payload)
          else throw error
        }
      }
    },

    async deleteByIds(name, ids) {
      for (const part of chunk(ids, DELETE_CHUNK)) {
        if (!part.length) continue
        await db.collection(name).where({ _id: command.in(part) }).remove()
      }
    }
  }
}

module.exports = { createCloudbaseStore, isAlreadyExists, isDuplicateKey }
