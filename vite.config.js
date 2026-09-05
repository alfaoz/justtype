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

      // Replace vite's index.html with the verified-bootstrap loader. The
      // loader is byte-stable across releases (nothing version-specific baked
      // in): it fetches the manifest at runtime, checks its signature on
      // production, and loads the bundles with SRI. See loader/template.html.
      const template = readFileSync(join(process.cwd(), 'loader/template.html'), 'utf-8')
      const isBeta = process.env.VITE_BETA === '1'
      const loaderHtml = template.replace('__JT_BETA__', String(isBeta))
      writeFileSync(join(distDir, 'index.html'), loaderHtml)

      // Hash every js/css chunk (lazy-loaded chunks included), not just the entry
      const hashable = allFiles.filter(f => f.endsWith('.js') || f.endsWith('.css')).sort()
      const files = hashable.map(f => ({
        file: f,
        hash: createHash('sha256').update(readFileSync(join(assetsDir, f))).digest('hex')
      }))

      // Entry files kept as top-level fields for backward compat + curl instructions
      // Everything else under assets/ (fonts) is listed too, so the offline
      // shell can precache a build completely. Not part of the SRI set.
      const assets = allFiles.filter(f => !hashable.includes(f)).sort().map(f => ({
        file: f,
        hash: createHash('sha256').update(readFileSync(join(assetsDir, f))).digest('hex')
      }))

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
        // The loader itself, so off-origin verifiers can check the one file
        // that decides what actually runs. Not in `files`: that array is
        // /assets/-relative and drives the SRI pins the loader applies.
        indexHtmlHash: createHash('sha256').update(loaderHtml).digest('hex'),
        // The offline shell worker, watched the same way (byte-stable too)
        swHash: createHash('sha256').update(readFileSync(join(distDir, 'sw.js'))).digest('hex'),
        assets,
        buildDate: new Date().toISOString()
      }

      writeFileSync(join(distDir, 'build-manifest.json'), JSON.stringify(manifest, null, 2))
      console.log(`\n✓ Build manifest written (v${version}, ${files.length} hashed files${isBeta ? ', beta' : ''})`)
      for (const f of files) {
        console.log(`  ${f.hash.slice(0, 16)}...  ${f.file}`)
      }
      console.log(`  ${manifest.indexHtmlHash.slice(0, 16)}...  index.html (loader)`)
      if (!isBeta) {
        console.log('  production build: sign before serving -- node scripts/sign-release.mjs')
      }
    }
  }
}

export default defineConfig({
  plugins: [react(), tailwindcss(), buildManifestPlugin()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Let Rollup split lazily-imported code on its own (that keeps the
        // React.lazy boundaries intact), then fold the tiny leftover chunks
        // into the chunk they always load with. Rollup only merges where it
        // does not change loading semantics, so the editor/collab code stays
        // off the critical path while the manifest stays short.
        //
        // Do NOT hand-write manualChunks for src/ components here: a shared
        // leaf module (strings.js) gets hoisted into the named chunk, the
        // entry then statically imports it, vite emits modulepreload, and
        // editor+collab load eagerly on every page load.
        //
        // At 120 kB the shared yjs chunk (which rollup was naming after
        // collabColors) folds into CollabPanel, taking the build from six
        // hashed files to five: the app, its stylesheet, and the three chunks
        // that genuinely load on demand. A collab session downloads the same
        // total either way. After changing this, always re-check that
        // dist/index.html still contains no `modulepreload` links.
        experimentalMinChunkSize: 120000,
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3003',
        changeOrigin: true,
      },
      '/collab': {
        target: 'http://localhost:3003',
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
