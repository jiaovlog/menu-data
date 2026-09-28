import { afterEach, describe, expect, it, vi } from 'vitest'
import worker from './index.js'

const env = {
  GITHUB_TOKEN: 'test-token',
  GITHUB_OWNER: 'jiaovlog',
  GITHUB_REPO: 'menu-data-store',
  GITHUB_BRANCH: 'main',
  APP_ACCESS_KEY: 'test-key',
  ALLOWED_ORIGIN: 'https://jiaovlog.github.io'
}

afterEach(() => vi.unstubAllGlobals())

describe('Cloudflare Worker API', () => {
  it('handles the CORS preflight for GitHub Pages', async () => {
    const request = new Request('https://worker.example/api/data', {
      method: 'OPTIONS',
      headers: { Origin: env.ALLOWED_ORIGIN }
    })
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(204)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe(env.ALLOWED_ORIGIN)
    expect(response.headers.get('Access-Control-Allow-Headers')).toContain('X-App-Key')
  })

  it('rejects an incorrect app key before contacting GitHub', async () => {
    const githubFetch = vi.fn()
    vi.stubGlobal('fetch', githubFetch)
    const request = new Request('https://worker.example/api/data', {
      headers: { Origin: env.ALLOWED_ORIGIN, 'X-App-Key': 'wrong' }
    })
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(401)
    expect(githubFetch).not.toHaveBeenCalled()
  })

  it('reads and decodes data.json from GitHub', async () => {
    const data = { schema_version: 1, dishes: [], ingredients: [], recipes: [], orders: [] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      content: btoa(unescape(encodeURIComponent(JSON.stringify(data)))),
      sha: 'a'.repeat(40)
    }), { status: 200 })))
    const request = new Request('https://worker.example/api/data', {
      headers: { Origin: env.ALLOWED_ORIGIN, 'X-App-Key': env.APP_ACCESS_KEY }
    })
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ data, revision: 'a'.repeat(40) })
  })

  it('returns a useful message for a hidden or missing private repository', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"message":"Not Found"}', { status: 404 })))
    const request = new Request('https://worker.example/api/data', {
      headers: { Origin: env.ALLOWED_ORIGIN, 'X-App-Key': env.APP_ACCESS_KEY }
    })
    const response = await worker.fetch(request, env)
    expect(response.status).toBe(502)
    await expect(response.json()).resolves.toMatchObject({ message: expect.stringContaining('data.json') })
  })
})
