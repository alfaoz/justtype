import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { createHash } from 'crypto'
import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'

function buildManifestPlugin() {
  return {
    name: 'build-manifest',
    closeBundle() {
      const distDir = join(process.cwd(), 'dist')
      const assetsDir = join(distDir, 'assets')
      const files = readdirSync(assetsDir)
      const jsFile = files.find(f => f.startsWith('index-') && f.endsWith('.js'))
      const cssFile = files.find(f => f.startsWith('index-') && f.endsWith('.css'))

      if (!jsFile || !cssFile) return

      const jsHash = createHash('sha256').update(readFileSync(join(assetsDir, jsFile))).digest('hex')
      const cssHash = createHash('sha256').update(readFileSync(join(assetsDir, cssFile))).digest('hex')

      // Read version from src/version.js
      const versionFile = readFileSync(join(process.cwd(), 'src/version.js'), 'utf-8')
      const versionMatch = versionFile.match(/VERSION\s*=\s*'([^']+)'/)
      const version = versionMatch ? versionMatch[1] : 'unknown'

      const manifest = {
        version,
        jsFile,
        cssFile,
        jsHash,
        cssHash,
        buildDate: new Date().toISOString()
      }

      writeFileSync(join(distDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2))
      console.log(`\n✓ Build manifest written (v${version})`)
      console.log(`  JS:  ${jsHash.slice(0, 16)}...`)
      console.log(`  CSS: ${cssHash.slice(0, 16)}...`)
    }
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), buildManifestPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
    },
  },
})
