'use strict'

/**
 * menuApi 云函数核心逻辑（与具体数据库实现无关）。
 *
 * 设计要点：
 * - 数据按实体拆分存放到文档型数据库集合中，一个实体一个文档。
 * - 使用 menu_meta 集合中的 revision 做乐观锁（compare-and-set），
 *   保证两台手机同时保存时不会静默覆盖对方的数据。
 * - 保存过程先抢写锁，再同步集合，最后自增 revision；写入失败会释放锁。
 * - 同一份代码同时运行在腾讯云云函数和本地开发服务器（本地文档库模拟层）中。
 */

const crypto = require('node:crypto')

const SCHEMA_VERSION = 1
const MAX_BODY_BYTES = 1024 * 1024
const LOCK_TIMEOUT_MS = 30 * 1000
const MAX_DOCS_PER_COLLECTION = 5000

const META_COLLECTION = 'menu_meta'
const META_DOC_ID = 'main'

const REQUIRED_LISTS = ['dishes', 'ingredients', 'recipes', 'orders']

const COLLECTIONS = [
  { key: 'dishes', name: 'menu_dishes', hasId: true, docId: (item) => String(item.id), limits: 2000 },
  { key: 'ingredients', name: 'menu_ingredients', hasId: true, docId: (item) => String(item.id), limits: 5000 },
  { key: 'recipes', name: 'menu_recipes', hasId: false, docId: (item) => `${item.dish_id}__${item.ingredient_id}`, limits: 20000 },
  { key: 'orders', name: 'menu_orders', hasId: true, docId: (item) => String(item.id), limits: 20000 }
]

const COLLECTION_NAMES = [META_COLLECTION, ...COLLECTIONS.map((collection) => collection.name)]

class ConflictError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ConflictError'
    this.status = 409
    this.code = 'CONFLICT'
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFilledString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value === undefined ? null : value)
}

function checkDish(item, index) {
  if (!isFilledString(item?.id)) return `dishes[${index}].id 缺失`
  if (!isFilledString(item?.name)) return `dishes[${index}].name 缺失`
  if (!isFiniteNumber(item?.price) || item.price < 0) return `dishes[${index}].price 必须是非负数字`
  return ''
}

function checkIngredient(item, index) {
  if (!isFilledString(item?.id)) return `ingredients[${index}].id 缺失`
  if (!isFilledString(item?.name)) return `ingredients[${index}].name 缺失`
  if (!isFilledString(item?.unit)) return `ingredients[${index}].unit 缺失`
  return ''
}

function checkRecipe(item, index) {
  if (!isFilledString(item?.dish_id)) return `recipes[${index}].dish_id 缺失`
  if (!isFilledString(item?.ingredient_id)) return `recipes[${index}].ingredient_id 缺失`
  if (!isFiniteNumber(item?.qty) || item.qty <= 0) return `recipes[${index}].qty 必须是正数`
  return ''
}

function checkOrder(item, index) {
  if (!isFilledString(item?.id)) return `orders[${index}].id 缺失`
  if (!isFilledString(item?.date)) return `orders[${index}].date 缺失`
  if (!Array.isArray(item?.items)) return `orders[${index}].items 必须是数组`
  for (const [itemIndex, line] of item.items.entries()) {
    if (!isFilledString(line?.dish_id)) return `orders[${index}].items[${itemIndex}].dish_id 缺失`
    if (!isFiniteNumber(Number(line?.portions))) return `orders[${index}].items[${itemIndex}].portions 必须是数字`
  }
  return ''
}

const ENTITY_CHECKS = { dishes: checkDish, ingredients: checkIngredient, recipes: checkRecipe, orders: checkOrder }

function validateData(data) {
  if (!isPlainObject(data)) return 'data 必须是对象'
  for (const key of REQUIRED_LISTS) {
    if (!Array.isArray(data[key])) return `data.${key} 必须是数组`
  }

  for (const collection of COLLECTIONS) {
    const list = data[collection.key]
    if (list.length > collection.limits) return `data.${collection.key} 条目数量超过 ${collection.limits} 上限`
    const check = ENTITY_CHECKS[collection.key]
    const seen = new Set()
    for (const [index, item] of list.entries()) {
      const error = check(item, index)
      if (error) return error
      const id = collection.docId(item)
      if (seen.has(id)) return `data.${collection.key} 存在重复主键 ${id}`
      seen.add(id)
    }
  }
  return ''
}

function toDocument(collection, item, timestamp) {
  const document = { ...item, _id: collection.docId(item), updated_at: timestamp }
  if (collection.hasId) delete document.id
  return document
}

function toEntity(collection, document) {
  const entity = { ...document }
  delete entity._id
  delete entity.updated_at
  if (collection.hasId) entity.id = document._id
  return entity
}

function contentKey(document) {
  const copy = { ...document }
  delete copy._id
  delete copy.updated_at
  return stableStringify(copy)
}

function planCollection(collection, items, existing, timestamp) {
  const existingById = new Map(existing.map((document) => [document._id, document]))
  const upserts = []
  const keep = new Set()

  for (const item of items) {
    const document = toDocument(collection, item, timestamp)
    keep.add(document._id)
    const current = existingById.get(document._id)
    if (!current) upserts.push({ document, exists: false })
    else if (contentKey(current) !== contentKey(document)) upserts.push({ document, exists: true })
  }

  const removals = existing.filter((document) => !keep.has(document._id)).map((document) => document._id)
  return { upserts, removals }
}

function sortOrders(orders) {
  return orders.sort((left, right) => {
    const leftKey = String(left.created_at || left.date || '')
    const rightKey = String(right.created_at || right.date || '')
    if (leftKey === rightKey) return String(left.id).localeCompare(String(right.id))
    return leftKey.localeCompare(rightKey)
  })
}

function createHandler(options) {
  const store = options.store
  const config = options.config || (() => ({}))
  const now = options.now || (() => Date.now())
  const log = options.log || console

  function settings() {
    const value = config() || {}
    return {
      appAccessKey: value.appAccessKey ? String(value.appAccessKey) : '',
      allowedOrigins: normalizeOrigins(value.allowedOrigins)
    }
  }

  function corsHeaders(origin) {
    const headers = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      Vary: 'Origin'
    }
    const matched = matchOrigin(origin, settings().allowedOrigins)
    if (matched) headers['Access-Control-Allow-Origin'] = matched
    return headers
  }

  async function loadAll() {
    const meta = await store.readMeta()
    const results = await Promise.all(COLLECTIONS.map((collection) => store.readCollection(collection.name)))
    const data = { schema_version: SCHEMA_VERSION }
    COLLECTIONS.forEach((collection, index) => {
      data[collection.key] = results[index].map((document) => toEntity(collection, document))
    })
    sortOrders(data.orders)
    return { data, revision: meta ? Number(meta.revision) || 0 : 0, updated_at: meta?.updated_at || null }
  }

  async function ensureMeta() {
    const meta = await store.readMeta()
    if (meta) return meta
    const initial = { revision: 0, lock_token: '', lock_at: 0, updated_at: new Date(now()).toISOString(), counts: {} }
    const created = await store.createMeta(initial)
    if (created) return initial
    const raced = await store.readMeta()
    return raced || initial
  }

  async function save(data, expectedRevision) {
    const meta = await ensureMeta()
    const timestamp = now()
    const lockToken = `${timestamp}-${crypto.randomBytes(8).toString('hex')}`

    if (meta.lock_token && timestamp - Number(meta.lock_at || 0) < LOCK_TIMEOUT_MS) {
      throw new ConflictError('另一台设备正在保存，请稍后重试')
    }

    const acquired = await store.acquireLock(String(meta.lock_token || ''), lockToken, timestamp)
    if (!acquired) throw new ConflictError('数据正在被其他设备保存，请稍后重试')

    try {
      if (String(meta.revision) !== String(expectedRevision)) {
        throw new ConflictError('数据已被另一台设备修改，请刷新后重试')
      }

      const counts = {}
      for (const collection of COLLECTIONS) {
        const existing = await store.readCollection(collection.name)
        const plan = planCollection(collection, data[collection.key], existing, new Date(timestamp).toISOString())
        if (plan.upserts.length) await store.upsertDocs(collection.name, plan.upserts)
        if (plan.removals.length) await store.deleteByIds(collection.name, plan.removals)
        counts[collection.key] = data[collection.key].length
      }

      const revision = (Number(meta.revision) || 0) + 1
      const released = await store.releaseLock(lockToken, {
        revision,
        lock_token: '',
        lock_at: 0,
        updated_at: new Date(timestamp).toISOString(),
        counts
      })
      if (!released) throw new Error('数据已写入，但版本号更新失败，请重新保存')
      return { revision }
    } catch (error) {
      await store.releaseLock(lockToken, { lock_token: '', lock_at: 0 }).catch(() => {})
      throw error
    }
  }

  async function handle(request) {
    const method = String(request?.method || 'GET').toUpperCase()
    const headers = corsHeaders(request?.headers?.origin || '')
    const failure = (status, message) => ({ status, headers, body: { message } })

    if (method === 'OPTIONS') {
      return {
        status: 204,
        headers: {
          ...headers,
          'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-App-Key',
          'Access-Control-Max-Age': '86400'
        },
        body: null
      }
    }

    try {
      if (!settings().appAccessKey) return failure(500, '云函数环境变量 APP_ACCESS_KEY 未配置')
      if (!safeEqual(readHeader(request, 'x-app-key'), settings().appAccessKey)) return failure(401, '访问密钥不正确')

      await store.ensureReady(COLLECTION_NAMES)

      if (method === 'GET') {
        const result = await loadAll()
        return { status: 200, headers, body: { data: result.data, revision: result.revision, updated_at: result.updated_at } }
      }

      if (method === 'PUT') {
        const raw = typeof request.body === 'string' ? request.body : JSON.stringify(request.body ?? null)
        if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return failure(413, '请求内容超过 1 MB 限制')

        let body
        try {
          body = JSON.parse(raw)
        } catch {
          return failure(400, '请求内容不是有效 JSON')
        }

        const invalid = validateData(body?.data)
        if (invalid) return failure(400, invalid)

        const result = await save(body.data, body.revision)
        return { status: 200, headers, body: { ok: true, revision: result.revision } }
      }

      return failure(405, 'Method Not Allowed')
    } catch (error) {
      if (error instanceof ConflictError) return failure(409, error.message)
      log.error?.('[menuApi] 处理请求失败', error)
      return failure(500, error?.message || '云函数内部错误')
    }
  }

  return { handle, loadAll, save, validateData }
}

function readHeader(request, name) {
  const headers = request?.headers || {}
  return headers[name] ?? headers[name.toLowerCase()] ?? headers[toHeaderCase(name)] ?? ''
}

function toHeaderCase(name) {
  return name.split('-').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('-')
}

function normalizeOrigins(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(',')
  return list.map((item) => String(item).trim().replace(/\/$/, '')).filter(Boolean)
}

function matchOrigin(origin, allowedOrigins) {
  const normalized = String(origin || '').replace(/\/$/, '')
  if (!normalized) return ''
  if (allowedOrigins.includes('*')) return normalized
  return allowedOrigins.includes(normalized) ? normalized : ''
}

function safeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left ?? ''), 'utf8').digest()
  const b = crypto.createHash('sha256').update(String(right ?? ''), 'utf8').digest()
  return crypto.timingSafeEqual(a, b)
}

module.exports = {
  COLLECTIONS,
  COLLECTION_NAMES,
  META_COLLECTION,
  META_DOC_ID,
  LOCK_TIMEOUT_MS,
  MAX_BODY_BYTES,
  SCHEMA_VERSION,
  ConflictError,
  createHandler,
  matchOrigin,
  normalizeOrigins,
  planCollection,
  safeEqual,
  toDocument,
  toEntity,
  validateData
}
