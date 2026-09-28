import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'

function normalizeBase(value) {
  const base = value?.trim() || '/'
  return `/${base.replace(/^\/+|\/+$/g, '')}${base === '/' ? '' : '/'}`
}

export default defineConfig(() => {
  const base = normalizeBase(process.env.VITE_BASE_PATH)

  return {
    base,
    plugins: [
      vue(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png'],
        manifest: {
          name: '配菜管理',
          short_name: '配菜',
          description: '菜单、配方、订单与采购配菜管理',
          lang: 'zh-CN',
          start_url: base,
          scope: base,
          display: 'standalone',
          background_color: '#f5f7f5',
          theme_color: '#1d6b4f',
          icons: [
            {
              src: `${base}icons/icon-192.png`,
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any'
            },
            {
              src: `${base}icons/icon-512.png`,
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any maskable'
            },
            {
              src: `${base}icons/icon.svg`,
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          runtimeCaching: [
            {
              urlPattern: ({ url }) => url.pathname.endsWith('/api/data'),
              handler: 'NetworkOnly'
            }
          ]
        }
      })
    ]
  }
})
