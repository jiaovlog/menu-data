import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { createCloudbaseStore } = require('./cloudbaseStore.js')
const { createHandler } = require('./core.js')

const APP_KEY = 'test-app-key'

/**
 * 云函数侧回归测试：用一个假的 CloudBase 数据库实现跑真实业务逻辑。
 *
 * 假实现刻意复刻线上会报错的行为：
 * - 写入内容里带 _id 会报“不能更新_id的值”（初次部署时就踩过这个坑）
 * - 读取不存在的文档会报 document not exists
 * - 重复 add 同一个 _id 会报 duplicate key
 */

function clone(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value))
}

function createFakeDb() {
  const collections = new Map()
  const command = { in: (list) => ({ __op: 'in', list }) }

  function docs(name) {
    if (!collections.has(name)) {
      const error = new Error(`collection not exists: ${name}`)
      error.code = 'DATABASE_COLLECTION_NOT_EXIST'
      throw error
    }
    return collections.get(name)
  }

  function assertNoId(payload, action) {
    if (payload && Object.prototype.hasOwnProperty.call(payload, '_id')) {
      throw new Error(`不能更新_id的值（${action}）`)
    }
  }

  function matches(document, condition) {
    return Object.entries(condition || {}).every(([key, value]) => {
      if (value && value.__op === 'in') return value.list.includes(document[key])
      return document[key] === value
    })
  }

  function createQuery(name) {
    let condition = null
    let offset = 0
    let max = 100
    const query = {
      where(next) {
        condition = next
        return query
      },
      skip(value) {
        offset = Number(value) || 0
        return query
      },
      limit(value) {
        max = Number(value) || 100
        return query
      },
      async get() {
        return { data: clone(docs(name).filter((item) => matches(item, condition)).slice(offset, offset + max)) }
      },
      async update(patch) {
        assertNoId(patch, 'update')
        const target = docs(name).filter((item) => matches(item, condition))
        for (const item of target) Object.assign(item, clone(patch))
        return { updated: target.length }
      },
      async remove() {
        const list = docs(name)
        const removing = list.filter((item) => matches(item, condition))
        for (const item of removing) list.splice(list.indexOf(item), 1)
        return { deleted: removing.length }
      }
    }
    return query
  }

  return {
    command,
    async createCollection(name) {
      if (collections.has(name)) {
        const error = new Error('collection already exists')
        error.code = '-501001'
        throw error
      }
      collections.set(name, [])
    },
    collection(name) {
      const query = createQuery(name)
      return {
        ...query,
        doc(id) {
          return {
            async get() {
              const found = docs(name).find((item) => item._id === id)
              if (!found) {
                const error = new Error('document not exists')
                error.code = 'DATABASE_DOCUMENT_NOT_EXIST'
                throw error
              }
              return { data: [clone(found)] }
            },
            async set(payload) {
              assertNoId(payload, 'set')
              const found = docs(name).find((item) => item._id === id)
              if (!found) {
                const error = new Error('document not exists')
                error.code = 'DATABASE_DOCUMENT_NOT_EXIST'
                throw error
              }
              for (const key of Object.keys(found)) if (key !== '_id') delete found[key]
              Object.assign(found, clone(payload))
              return { updated: 1 }
            },
            async remove() {
              const list = docs(name)
              const index = list.findIndex((item) => item._id === id)
              if (index >= 0) list.splice(index, 1)
              return { deleted: index >= 0 ? 1 : 0 }
            }
          }
        },
        async add(payload) {
          const list = docs(name)
          if (list.some((item) => item._id === payload._id)) {
            const error = new Error('duplicate key error')
            error.code = 'DATABASE_DUPLICATE_KEY'
            throw error
          }
          list.push(clone(payload))
          return { id: payload._id }
        }
      }
    },
    dump(name) {
      return clone(collections.get(name) || [])
    },
    names() {
      return [...collections.keys()]
    }
  }
}

function createCloudApi() {
  const db = createFakeDb()
  const store = createCloudbaseStore({ db, log: { warn: () => {}, error: () => {} } })
  const api = createHandler({ store, config: () => ({ appAccessKey: APP_KEY, allowedOrigins: '*' }) })
  return { db, api }
}

function sampleData() {
  return {
    schema_version: 1,
    dishes: [{ id: 'd1', name: '辣椒炒肉', price: 38, active: true }],
    ingredients: [{ id: 'i2', name: '辣椒', unit: '斤', discrete: false }],
    recipes: [{ dish_id: 'd1', ingredient_id: 'i2', qty: 0.5 }],
    orders: [
      {
        id: 'o1',
        name: '张先生',
        date: '2024-05-01',
        tables: 1,
        status: '未结算',
        created_at: '2024-05-01T10:00:00.000Z',
        items: [{ dish_id: 'd1', name_snapshot: '辣椒炒肉', price_snapshot: 38, portions: 2, is_addon: false, table_no: null }]
      }
    ]
  }
}

function request(api, { method = 'GET', body } = {}) {
  return api.handle({
    method,
    path: '/menuApi',
    headers: { 'x-app-key': APP_KEY },
    body: body === undefined ? '' : JSON.stringify(body)
  })
}

describe('cloudbaseStore（CloudBase 文档型数据库）', () => {
  it('集合不存在时 readMeta 返回 null，而不是抛错', async () => {
    const db = createFakeDb()
    const store = createCloudbaseStore({ db, log: { warn: () => {} } })
    await expect(store.readMeta()).resolves.toBeNull()
  })

  it('ensureReady 自动建集合，重复调用不报错', async () => {
    const db = createFakeDb()
    const store = createCloudbaseStore({ db, log: { warn: () => {} } })
    await store.ensureReady(['menu_meta', 'menu_dishes'])
    await store.ensureReady(['menu_meta', 'menu_dishes'])
    expect(db.names().sort()).toEqual(['menu_dishes', 'menu_meta'])
  })

  it('保存时不把 _id 写进文档内容，新增用 add、更新用 set', async () => {
    const { db, api } = createCloudApi()
    const created = await request(api, { method: 'PUT', body: { data: sampleData(), revision: 0 } })
    expect(created.status).toBe(200)
    expect(created.body).toEqual({ ok: true, revision: 1 })

    expect(db.dump('menu_dishes')).toEqual([
      { name: '辣椒炒肉', price: 38, active: true, _id: 'd1', updated_at: expect.any(String) }
    ])
    expect(db.dump('menu_recipes')[0]._id).toBe('d1__i2')
    expect(db.dump('menu_meta')[0]).toMatchObject({ _id: 'main', revision: 1, lock_token: '' })

    const loaded = await request(api)
    expect(loaded.body.revision).toBe(1)
    expect(loaded.body.data.dishes).toEqual([{ name: '辣椒炒肉', price: 38, active: true, id: 'd1' }])
  })

  it('二次保存走更新分支，删除的记录会被移除', async () => {
    const { db, api } = createCloudApi()
    await request(api, { method: 'PUT', body: { data: sampleData(), revision: 0 } })

    const next = sampleData()
    next.dishes[0].price = 42
    next.orders = []
    const saved = await request(api, { method: 'PUT', body: { data: next, revision: 1 } })
    expect(saved.body.revision).toBe(2)

    expect(db.dump('menu_dishes')[0].price).toBe(42)
    expect(db.dump('menu_orders')).toEqual([])
    expect(db.dump('menu_meta')[0].revision).toBe(2)
  })

  it('版本号过期返回 409，不写入任何文档', async () => {
    const { db, api } = createCloudApi()
    await request(api, { method: 'PUT', body: { data: sampleData(), revision: 0 } })

    const stale = sampleData()
    stale.dishes = [{ id: 'd9', name: '别人的菜', price: 1, active: true }]
    const conflict = await request(api, { method: 'PUT', body: { data: stale, revision: 0 } })
    expect(conflict.status).toBe(409)
    expect(db.dump('menu_dishes').map((item) => item._id)).toEqual(['d1'])
    expect(db.dump('menu_meta')[0]).toMatchObject({ revision: 1, lock_token: '' })
  })
})
