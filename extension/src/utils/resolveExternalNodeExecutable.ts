import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { promisify } from 'node:util'
import { z } from 'zod'
import { MIN_NODE_MAJOR_VERSION, PREREQUISITE_TIMEOUT_MS } from '../constants'

const executeFile = promisify(execFile)
const nodeSchema = z.object({ version: z.string(), executable: z.string() })

/** Resolves a verified external Node for runtime and Cursor bridge startup when an editor workspace requests it. @example await resolveExternalNodeExecutable('node') */
export async function resolveExternalNodeExecutable(
  configuredExecutable: string,
): Promise<string> {
  const result = await executeFile(
    configuredExecutable,
    [
      '-p',
      'JSON.stringify({version:process.versions.node,executable:process.execPath})',
    ],
    { timeout: PREREQUISITE_TIMEOUT_MS },
  )
  const node = nodeSchema.parse(JSON.parse(result.stdout))
  const major = Number(node.version.split('.')[0])
  if (
    !isAbsolute(node.executable) ||
    !Number.isInteger(major) ||
    major < MIN_NODE_MAJOR_VERSION ||
    node.executable === process.execPath
  ) {
    throw new Error(
      'Expected an absolute external Node.js >=24 executable, not Electron.',
    )
  }
  return node.executable
}
