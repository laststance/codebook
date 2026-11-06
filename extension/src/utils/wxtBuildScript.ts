/**
 * The script the external Node runs with `--input-type=module --eval`: it imports the project's own `wxt` (resolved from the working folder, the project root) and calls `build()` with an inline config.
 * Arguments: project root, output folder, result file. It writes `{ ok, wxtVersion, outDir }` or `{ ok: false, message }` to the result file and never runs the project's build script or edits its config.
 * Used by {@link buildWxtExtension}.
 */
export const WXT_BUILD_SCRIPT = `
import { findPackageJSON } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const [root, outDir, resultFile] = process.argv.slice(1)
const writeResult = (result) => writeFileSync(resultFile, JSON.stringify(result))
try {
  const { build } = await import('wxt')
  await build({
    root,
    outDir,
    mode: 'development',
    vite: () => ({ build: { sourcemap: true, minify: false } }),
  })
  let wxtVersion = 'unknown'
  try {
    wxtVersion = JSON.parse(readFileSync(findPackageJSON('wxt', join(root, 'package.json')), 'utf8')).version
  } catch {}
  writeResult({ ok: true, wxtVersion, outDir })
} catch (error) {
  const message = String(error && error.stack ? error.stack : error)
  console.error(message)
  writeResult({ ok: false, message })
  process.exitCode = 1
}
`
