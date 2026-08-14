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
      const allFiles = readdirSync(assetsDir)

      // Hash every js/css chunk (lazy-loaded chunks included), not just the entry
      const hashable = allFiles.filter(f => f.endsWith('.js') || f.endsWith('.css')).sort()
      const files = hashable.map(f => ({
        file: f,
        hash: createHash('sha256').update(readFileSync(join(assetsDir, f))).digest('hex')
      }))

      // Entry files kept as top-level fields for backward compat + curl instructions
      const jsEntry = files.find(f => f.file.startsWith('index-') && f.file.endsWith('.js'))
      const cssEntry = files.find(f => f.file.startsWith('index-') && f.file.endsWith('.css'))
      if (!jsEntry || !cssEntry) return

      // Read version from src/version.js
      const versionFile = readFileSync(join(process.cwd(), 'src/version.js'), 'utf-8')
      const versionMatch = versionFile.match(/VERSION\s*=\s*'([^']+)'/)
      const version = versionMatch ? versionMatch[1] : 'unknown'

      const manifest = {
        version,
        jsFile: jsEntry.file,
        cssFile: cssEntry.file,
        jsHash: jsEntry.hash,
        cssHash: cssEntry.hash,
        files,
        buildDate: new Date().toISOString()
      }

      writeFileSync(join(distDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2))
      console.log(`\n✓ Build manifest written (v${version}, ${files.length} hashed files)`)
      for (const f of files) {
        console.log(`  ${f.hash.slice(0, 16)}...  ${f.file}`)
      }
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
