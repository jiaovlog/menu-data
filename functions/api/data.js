const jsonHeaders = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: jsonHeaders })
}

function decodeBase64Utf8(value) {
  const binary = atob(value.replace(/\n/g, ''))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function encodeBase64Utf8(value) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export async function onRequest(context) {
  const { GITEE_TOKEN, GITEE_OWNER, GITEE_REPO, APP_ACCESS_KEY } = context.env
  if (!GITEE_TOKEN || !GITEE_OWNER || !GITEE_REPO || !APP_ACCESS_KEY) {
    return json({ message: '服务端环境变量未完整配置' }, 500)
  }
  if (context.request.headers.get('X-App-Key') !== APP_ACCESS_KEY) {
    return json({ message: '访问密钥不正确' }, 401)
  }

  const apiUrl = `https://gitee.com/api/v5/repos/${encodeURIComponent(GITEE_OWNER)}/${encodeURIComponent(GITEE_REPO)}/contents/data.json`
  const authHeaders = { Authorization: `token ${GITEE_TOKEN}`, Accept: 'application/json' }

  if (context.request.method === 'GET') {
    const upstream = await fetch(apiUrl, { headers: authHeaders })
    if (!upstream.ok) return json({ message: '无法读取 Gitee 数据文件' }, upstream.status)
    const file = await upstream.json()
    try {
      return json({ data: JSON.parse(decodeBase64Utf8(file.content)), revision: file.sha })
    } catch {
      return json({ message: 'Gitee 数据文件格式无效' }, 502)
    }
  }

  if (context.request.method === 'PUT') {
    let body
    try {
      body = await context.request.json()
    } catch {
      return json({ message: '请求内容不是有效 JSON' }, 400)
    }
    if (!body?.data || !body?.revision) return json({ message: '缺少数据或版本号' }, 400)

    const upstream = await fetch(apiUrl, {
      method: 'PUT',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: encodeBase64Utf8(JSON.stringify(body.data, null, 2)),
        sha: body.revision,
        message: `更新配菜数据 ${new Date().toISOString()}`
      })
    })
    const result = await upstream.json().catch(() => ({}))
    if (!upstream.ok) {
      const isConflict = upstream.status === 409 || /sha|conflict|冲突/i.test(result.message || '')
      return json({ message: isConflict ? '数据版本冲突' : '写入 Gitee 失败' }, isConflict ? 409 : upstream.status)
    }
    return json({ ok: true, revision: result.content?.sha })
  }

  return json({ message: 'Method Not Allowed' }, 405)
}
