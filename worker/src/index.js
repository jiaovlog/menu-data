const MAX_BODY_BYTES = 1024 * 1024
const REQUIRED_LISTS = ['dishes', 'ingredients', 'recipes', 'orders']

function allowedOrigin(request, env) {
  const configured = String(env.ALLOWED_ORIGIN || '').replace(/\/$/, '')
  const origin = String(request.headers.get('Origin') || '').replace(/\/$/, '')
  return configured && origin === configured ? origin : ''
}

function responseHeaders(request, env) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    Vary: 'Origin'
  }
  const origin = allowedOrigin(request, env)
  if (origin) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function json(request, env, payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: responseHeaders(request, env) })
}

async function secureEqual(left, right) {
  const encoder = new TextEncoder()
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(String(left || ''))),
    crypto.subtle.digest('SHA-256', encoder.encode(String(right || '')))
  ])
  const a = new Uint8Array(leftHash)
  const b = new Uint8Array(rightHash)
  let difference = a.length ^ b.length
  for (let index = 0; index < Math.min(a.length, b.length); index += 1) difference |= a[index] ^ b[index]
  return difference === 0
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\n/g, ''))
  return new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function validateData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return 'data 必须是对象'
  for (const key of REQUIRED_LISTS) {
    if (!Array.isArray(data[key])) return `data.${key} 必须是数组`
  }
  if (data.dishes.length > 2000 || data.ingredients.length > 5000 || data.recipes.length > 20000 || data.orders.length > 20000) {
    return '数据条目数量超过限制'
  }
  return ''
}

function githubHeaders(env) {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json',
    'User-Agent': 'menu-data-worker',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

function githubUrl(env) {
  const owner = encodeURIComponent(env.GITHUB_OWNER)
  const repository = encodeURIComponent(env.GITHUB_REPO)
  const branch = encodeURIComponent(env.GITHUB_BRANCH || 'main')
  return `https://api.github.com/repos/${owner}/${repository}/contents/data.json?ref=${branch}`
}

function githubFailureMessage(status) {
  if (status === 401 || status === 403) return 'GitHub Token 无效或缺少 Contents 权限'
  if (status === 404) return 'GitHub 找不到 data.json，请检查仓库名、分支、文件路径和 Token 仓库权限'
  return `GitHub API 请求失败（${status}）`
}

async function handleGet(request, env) {
  const upstream = await fetch(githubUrl(env), { headers: githubHeaders(env) })
  if (!upstream.ok) return json(request, env, { message: githubFailureMessage(upstream.status) }, 502)

  const file = await upstream.json()
  try {
    const data = JSON.parse(decodeBase64Utf8(file.content))
    const error = validateData(data)
    if (error) return json(request, env, { message: `data.json 格式错误：${error}` }, 502)
    return json(request, env, { data, revision: file.sha })
  } catch {
    return json(request, env, { message: 'data.json 不是有效的 UTF-8 JSON 文件' }, 502)
  }
}

async function handlePut(request, env) {
  const declaredSize = Number(request.headers.get('Content-Length') || 0)
  if (declaredSize > MAX_BODY_BYTES) return json(request, env, { message: '请求内容超过 1 MB 限制' }, 413)

  const text = await request.text()
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return json(request, env, { message: '请求内容超过 1 MB 限制' }, 413)
  }

  let body
  try {
    body = JSON.parse(text)
  } catch {
    return json(request, env, { message: '请求内容不是有效 JSON' }, 400)
  }

  const validationError = validateData(body.data)
  if (validationError) return json(request, env, { message: validationError }, 400)
  if (!/^[0-9a-f]{40}$/i.test(body.revision || '')) return json(request, env, { message: '数据版本号无效，请刷新后重试' }, 400)

  const content = JSON.stringify(body.data, null, 2)
  const upstream = await fetch(githubUrl(env), {
    method: 'PUT',
    headers: githubHeaders(env),
    body: JSON.stringify({
      message: `更新配菜数据 ${new Date().toISOString()}`,
      content: encodeBase64Utf8(content),
      sha: body.revision,
      branch: env.GITHUB_BRANCH || 'main'
    })
  })
  const result = await upstream.json().catch(() => ({}))
  if (!upstream.ok) {
    if (upstream.status === 409 || (upstream.status === 422 && /sha|conflict/i.test(result.message || ''))) {
      return json(request, env, { message: '数据已被另一台设备修改，请刷新后重试' }, 409)
    }
    return json(request, env, { message: githubFailureMessage(upstream.status) }, 502)
  }
  return json(request, env, { ok: true, revision: result.content?.sha })
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url)
    if (url.pathname !== '/api/data') return json(request, env, { message: 'Not Found' }, 404)

    if (request.method === 'OPTIONS') {
      if (!allowedOrigin(request, env)) return json(request, env, { message: 'Origin Not Allowed' }, 403)
      const headers = responseHeaders(request, env)
      headers['Access-Control-Allow-Methods'] = 'GET, PUT, OPTIONS'
      headers['Access-Control-Allow-Headers'] = 'Content-Type, X-App-Key'
      headers['Access-Control-Max-Age'] = '86400'
      return new Response(null, { status: 204, headers })
    }

    const requiredVariables = ['GITHUB_TOKEN', 'GITHUB_OWNER', 'GITHUB_REPO', 'APP_ACCESS_KEY', 'ALLOWED_ORIGIN']
    if (requiredVariables.some((name) => !env[name])) return json(request, env, { message: 'Worker 环境变量未完整配置' }, 500)
    if (!(await secureEqual(request.headers.get('X-App-Key'), env.APP_ACCESS_KEY))) {
      return json(request, env, { message: '访问密钥不正确' }, 401)
    }
    if (request.method === 'GET') return handleGet(request, env)
    if (request.method === 'PUT') return handlePut(request, env)
    return json(request, env, { message: 'Method Not Allowed' }, 405)
  }
}
