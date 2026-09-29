import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const { COLLECTION_NAMES, META_COLLECTION, META_DOC_ID, LOCK_TIMEOUT_MS, createHandler } = require('./core.js')
const { createMemoryStore } = require('./memoryStore.js')

const APP_KEY = 'test-app-key'

function createApi(options = {}) {
  const store = options.store || createMemoryStore()
  let clock = options.startAt || Date.now()
  const api = createHandler({
    store,
    config: () => ({ appAccessKey: APP_KEY, allowedOrigins: options.allowedOrigins ?? 'https://example.tcloudbaseapp.com' }),
    now: () => clock
  })
  return { api, store, advance: (ms) => { clock += ms }, setClock: (value) => { clock = value } }
}

function sampleData(overrides = {}) {
  return {
    schema_version: 1,
    dishes: [
      { id: 'd1', name: '辣椒炒肉', price: 38, active: true },
      { id: 'd2', name: '鳝鱼', price: 58, active: true }
    ],
    ingredients: [
      { id: 'i1', name: '莴笋', unit: '根', discrete: true },
      { id: 'i2', name: '辣椒', unit: '斤', discrete: false }
    ],
    recipes: [
      { dish_id: 'd1', ingredient_id: 'i2', qty: 0.5 },
      { dish_id: 'd2', ingredient_id: 'i1', qty: 1 }
    ],
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
    ],
    ...overrides
  }
}

function request(api, { method = 'GET', key = APP_KEY, origin = '', body } = {}) {
  return api.handle({
    method,
    path: '/menuApi',
    headers: { 'x-app-key': key, origin },
    body: body === undefined ? '' : JSON.stringify(body)
  })
}

describe('menuApi 云函数', () => {
  it('空数据库返回空清单和版本号 0', async () => {
    const { api } = createApi()
    const result = await request(api)
    expect(result.status).toBe(200)
    expect(result.body.revision).toBe(0)
    expect(result.body.data).toEqual({ schema_version: 1, dishes: [], ingredients: [], recipes: [], orders: [] })
  })

  it('访问密钥不正确时返回 401 且不泄露数据', async () => {
    const { api } = createApi()
    const result = await request(api, { key: 'wrong' })
    expect(result.status).toBe(401)
    expect(result.body).toEqual({ message: '访问密钥不正确' })
  })

  it('未配置 APP_ACCESS_KEY 时返回 500', async () => {
    const store = createMemoryStore()
    const api = createHandler({ store, config: () => ({}) })
    const result = await request(api)
    expect(result.status).toBe(500)
    expect(result.body.message).toContain('APP_ACCESS_KEY')
  })

  it('保存后可以读回同样的数据，revision 递增', async () => {
    const { api } = createApi()
    const created = await request(api, { method: 'PUT', body: { data: sampleData(), revision: 0 } })
    expect(created.status).toBe(200)
    expect(created.body).toEqual({ ok: true, revision: 1 })

    const loaded = await request(api)
    expect(loaded.body.revision).toBe(1)
    expect(loaded.body.data.dishes).toHaveLength(2)
    expect(loaded.body.data.recipes).toEqual([
      { dish_id: 'd1', ingredient_id: 'i2', qty: 0.5 },
      { dish_id: 'd2', ingredient_id: 'i1', qty: 1 }
    ])
    expect(loaded.body.data.orders[0].items[0].name_snapshot).toBe('辣椒炒肉')
  })

  it('按实体写入文档型数据库集合，一个实体一个文档', async () => {
    const { api, store } = createApi()
    await request(api, { method: 'PUT', body: { data: sampleData(), revision: 0 } })

    const dishes = await store.readCollection('menu_dishes')
    expect(dishes.map((item) => item._id).sort()).toEqual(['d1', 'd2'])
    expect(dishes[0]).toMatchObject({ name: expect.any(String), price: expect.any(Number), updated_at: expect.any(String) })
    expect(dishes[0].id).toBeUndefined()

    const recipes = await store.readCollection('menu_recipes')
    expect(recipes.map((item) => item._id).sort()).toEqual(['d1__i2', 'd2__i1'])

    const meta = await store.readMeta()
    expect(meta.revision).toBe(1)
    expect(meta.lock_token).toBe('')
  })

  it('用旧版本号保存时返回 409，不会覆盖对方数据', async () => {
    const { api } = createApi()
    await request(api, { method: 'PUT', body: { data: sampleData(), revision: 0 } })

    const stale = sampleData({ dishes: [{ id: 'd9', name: '别人的菜', price: 1, active: true }] })
    const conflict = await request(api, { method: 'PUT', body: { data: stale, revision: 0 } })
    expect(conflict.status).toBe(409)
    expect(conflict.body.message).toContain('另一台设备')

    const loaded = await request(api)
    expect(loaded.body.data.dishes).toHaveLength(2)
  })

  it('保存时删除的记录会从数据库中移除', async () => {
    const { api, store } = createApi()
    await request(api, { method: 'PUT', body: { data: sampleData(), revision: 0 } })

    const next = sampleData({
      dishes: [{ id: 'd1', name: '辣椒炒肉', price: 40, active: true }],
      recipes: [{ dish_id: 'd1', ingredient_id: 'i2', qty: 0.6 }],
      orders: []
    })
    const saved = await request(api, { method: 'PUT', body: { data: next, revision: 1 } })
    expect(saved.body.revision).toBe(2)

    expect((await store.readCollection('menu_dishes')).map((item) => item._id)).toEqual(['d1'])
    expect(await store.readCollection('menu_orders')).toEqual([])
    expect((await store.readCollection('menu_recipes')).map((item) => item._id)).toEqual(['d1__i2'])

    const loaded = await request(api)
    expect(loaded.body.data.dishes[0].price).toBe(40)
  })

  it('另一台设备持锁期间返回 409，锁过期后可以继续保存', async () => {
    const { api, store, advance } = createApi()
    await request(api, { method: 'PUT', body: { data: sampleData(), revision: 0 } })

    const meta = await store.readMeta()
    await store.acquireLock(String(meta.lock_token || ''), 'other-device-token', Date.now())

    const locked = await request(api, { method: 'PUT', body: { data: sampleData(), revision: 1 } })
    expect(locked.status).toBe(409)
    expect(locked.body.message).toContain('正在保存')

    advance(LOCK_TIMEOUT_MS + 1000)
    const retried = await request(api, { method: 'PUT', body: { data: sampleData(), revision: 1 } })
    expect(retried.status).toBe(200)
    expect(retried.body.revision).toBe(2)
    expect((await store.readMeta()).lock_token).toBe('')
  })

  it('CORS 只回显白名单来源，并处理预检请求', async () => {
    const { api } = createApi()
    const preflight = await request(api, { method: 'OPTIONS', origin: 'https://example.tcloudbaseapp.com' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers['Access-Control-Allow-Origin']).toBe('https://example.tcloudbaseapp.com')

    const blocked = await request(api, { origin: 'https://evil.example.com' })
    expect(blocked.headers['Access-Control-Allow-Origin']).toBeUndefined()
  })

  it('数据格式错误返回 400，超长请求返回 413', async () => {
    const { api } = createApi()
    const missing = await request(api, { method: 'PUT', body: { data: { dishes: [] }, revision: 0 } })
    expect(missing.status).toBe(400)
    expect(missing.body.message).toContain('ingredients')

    const duplicated = await request(api, {
      method: 'PUT',
      body: { data: sampleData({ dishes: [{ id: 'd1', name: 'a', price: 1 }, { id: 'd1', name: 'b', price: 2 }] }), revision: 0 }
    })
    expect(duplicated.status).toBe(400)
    expect(duplicated.body.message).toContain('重复主键')

    const huge = await request(api, {
      method: 'PUT',
      body: { data: sampleData({ ingredients: [{ id: 'i9', name: 'x'.repeat(1024 * 1024 + 10), unit: '斤' }] }), revision: 0 }
    })
    expect(huge.status).toBe(413)
  })

  it('重复保存同样的数据不会重复写文档', async () => {
    const { api, store } = createApi()
    const writes = []
    const original = store.upsertDocs.bind(store)
    store.upsertDocs = async (name, documents) => {
      writes.push([name, documents.length])
      return original(name, documents)
    }

    await request(api, { method: 'PUT', body: { data: sampleData(), revision: 0 } })
    const first = writes.reduce((sum, [, count]) => sum + count, 0)
    expect(first).toBe(7)

    writes.length = 0
    await request(api, { method: 'PUT', body: { data: sampleData(), revision: 1 } })
    expect(writes).toEqual([])
  })

  it('导出的集合名与文档型数据库设计一致', () => {
    expect(COLLECTION_NAMES).toEqual(['menu_meta', 'menu_dishes', 'menu_ingredients', 'menu_recipes', 'menu_orders'])
    expect(META_COLLECTION).toBe('menu_meta')
    expect(META_DOC_ID).toBe('main')
  })
})
