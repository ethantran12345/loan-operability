import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

/**
 * Serve api/extract.ts under `npm run dev`, so the app talks to the same handler
 * locally that Vercel runs in production. NVIDIA_API_KEY is read from the shell
 * or from .env.local; with neither, the handler serves the cached fixtures.
 */
function devApi(): Plugin {
  return {
    name: 'dev-api-extract',
    configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, '')
      for (const key of ['NVIDIA_API_KEY', 'NEMOTRON_MODEL']) {
        if (!process.env[key] && env[key]) process.env[key] = env[key]
      }

      server.middlewares.use('/api/extract', async (req, res) => {
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          const mod = (await server.ssrLoadModule('/api/extract.ts')) as Record<
            string,
            ((request: Request) => Promise<Response>) | undefined
          >
          const handler = mod[req.method ?? 'GET']
          if (!handler) {
            res.statusCode = 405
            res.end()
            return
          }
          const response = await handler(
            new Request(`http://${req.headers.host ?? 'localhost'}/api/extract`, {
              method: req.method,
              headers: { 'content-type': 'application/json' },
              body: Buffer.concat(chunks),
            }),
          )
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          res.end(await response.text())
        } catch (err) {
          server.ssrFixStacktrace(err as Error)
          res.statusCode = 500
          res.setHeader('content-type', 'application/json')
          res.end(JSON.stringify({ error: (err as Error).message }))
        }
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), devApi()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
