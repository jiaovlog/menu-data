import { createRequire } from 'node:module'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)

/**
 * 本地开发服务器插件：把云函数 menuApi 挂到 /api 上。
 *
 * 云函数代码（cloudbase/functions/menuApi）不做任何改动，
 * 只是把文档型数据库换成 cloudbase/local/fileStore.js（落盘到 .local/menu-db.json）。
 * 这样可以先用手机在同一套流程里验证，之后直接部署到腾讯云 CloudBase。
 */
export function cloudbaseLocalApi(options = {}) {
  const dataFile = path.resolve(options.root || process.cwd(), options.dataFile || '.local/menu-db.json')
  const seedModule = options.seedModule || 'src/lib/defaultData.js'
  const devAppKey = process.env.APP_ACCESS_KEY || options.devAppKey || 'local-dev-key'

  let handlerPromise = null

  async function getHandler() {
    if (!handlerPromise) {
      handlerPromise = buildHandler().catch((error) => {
        handlerPromise = null
        throw error
      })
    }
    return handlerPromise
  }

  async function buildHandler() {
    const { createHandler, COLLECTION_NAMES } = require('../cloudbase/functions/menuApi/lib/core.js')
    const { createFileStore } = require('../cloudbase/local/fileStore.js')

    let seed = null
    try {
      const module = await import(pathToFileURL(path.resolve(options.root || process.cwd(), seedModule)).href)
      seed = module.DEMO_DATA || null
    } catch (error) {
      console.warn(`[menuApi] 未能加载示例数据 ${seedModule}：${error.message}`)
    }

    console.log(`[menuApi] 本地文档库：${dataFile}，集合同云端：${COLLECTION_NAMES.join('、')}`)
    const store = createFileStore({ file: dataFile, seed })
    return createHandler({
      store,
      config: () => ({ appAccessKey: devAppKey, allowedOrigins: '*' })
    })
  }

  function readRequestBody(request) {
    return new Promise((resolve, reject) => {
      const chunks = []
      request.on('data', (chunk) => chunks.push(chunk))
      request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      request.on('error', reject)
    })
  }

  async function middleware(request, response, next) {
    if (!['GET', 'PUT', 'OPTIONS'].includes(request.method)) return next()

    try {
      const handler = await getHandler()
      const body = request.method === 'PUT' ? await readRequestBody(request) : ''
      const result = await handler.handle({
        method: request.method,
        path: (request.url || '/').split('?')[0],
        headers: request.headers,
        body
      })

      response.statusCode = result.status
      for (const [key, value] of Object.entries(result.headers || {})) response.setHeader(key, value)
      response.end(result.body === null ? '' : JSON.stringify(result.body))
    } catch (error) {
      response.statusCode = 500
      response.setHeader('Content-Type', 'application/json; charset=utf-8')
      response.end(JSON.stringify({ message: `本地模拟云函数异常：${error.message}` }))
    }
  }

  return {
    name: 'menu-data-cloudbase-local-api',
    configureServer(server) {
      server.middlewares.use('/api', middleware)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', middleware)
    }
  }
}
