import { execFileSync } from 'node:child_process'
import { readFile, realpath } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { HostConfiguration } from '../hostBrowser'

/** Resolves metadata beside the binary the runner will spawn and rejects a mismatched CLI before launch. @example await readHostInstallation('cursor') // selected Cursor bundle and matching CLI */
export async function readHostInstallation(
  id: HostConfiguration['id'],
  binaryOverride?: string,
  cliOverride?: string,
): Promise<{
  binaryPath: string
  cliPath: string
  host: HostConfiguration
  cliVersion: string[]
}> {
  const defaultRoot =
    id === 'cursor'
      ? '/Applications/Cursor.app/Contents'
      : '/Applications/Visual Studio Code.app/Contents'
  const binaryPath = await realpath(
    binaryOverride ??
      join(defaultRoot, 'MacOS', id === 'cursor' ? 'Cursor' : 'Code'),
  )
  const bundleRoot = dirname(dirname(binaryPath))
  const cliPath =
    cliOverride ??
    join(bundleRoot, 'Resources/app/bin', id === 'cursor' ? 'cursor' : 'code')
  const product: unknown = JSON.parse(
    await readFile(join(bundleRoot, 'Resources/app/product.json'), 'utf8'),
  )
  if (
    !product ||
    typeof product !== 'object' ||
    !('version' in product) ||
    typeof product.version !== 'string' ||
    !('commit' in product) ||
    typeof product.commit !== 'string'
  )
    throw new Error('Selected editor bundle has no version/commit metadata')
  const cliVersion = execFileSync(cliPath, ['--version'], { encoding: 'utf8' })
    .trim()
    .split('\n')
  // A CLI from a different installation must not describe the selected executable.
  if (cliVersion[0] !== product.version || cliVersion[1] !== product.commit)
    throw new Error(
      'Editor CLI version/commit differs from the selected binary bundle',
    )
  const apiVersion =
    'vscodeVersion' in product && typeof product.vscodeVersion === 'string'
      ? product.vscodeVersion
      : product.version
  return {
    binaryPath,
    cliPath,
    cliVersion,
    host: {
      id,
      productVersion: product.version,
      apiVersion,
      commit: product.commit,
    },
  }
}
