import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backendTarget = env.VITE_API_URL || 'http://127.0.0.1:8001'

  return {
    plugins: [react()],
    server: {
      port: 5174,
      host: true,
      proxy: {
        '/api': {
          target: backendTarget,
          changeOrigin: true,
          secure: false,
          ws: true,
          configure: (proxy) => {
            proxy.on('error', (err, _req, res) => {
              if (res && !res.headersSent && typeof res.writeHead === 'function') {
                res.writeHead(503, { 'Content-Type': 'application/json' })
                res.end(
                  JSON.stringify({
                    error: 'Backend proxy error',
                    message: `Could not connect to FastAPI backend at ${backendTarget}: ${err.message}`,
                  })
                )
              }
            })
          },
        },
      },
    },
    build: {
      chunkSizeWarningLimit: 800,
    },
  }
})
