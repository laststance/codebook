import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { currentStorageOwner } from '../../utils/currentStorageOwner'

import { INSTALLATION_ID } from './INSTALLATION_ID'
import { instanceIdOf } from './instanceIdOf'

/**
 * Writes one descriptor with fake values that names this machine as its owner; `overrides` replace any field.
 * The default descriptor is the one a Devin Desktop window with AI chat set up writes: a loopback url and `devinChat: true`.
 */
export async function writeDescriptor(
  agentDir: string,
  index: number,
  workspace: string,
  pid: number,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const path = join(agentDir, `${instanceIdOf(index)}.connection.json`)
  await writeFile(
    path,
    JSON.stringify({
      url: 'http://127.0.0.1:1/mcp',
      token: 'fake-test-value',
      instanceId: instanceIdOf(index),
      workspace,
      apiVersion: '1.0',
      pid,
      ...(await currentStorageOwner()),
      devinChat: true,
      devinSetupInstallation: INSTALLATION_ID,
      ...overrides,
    }),
    { mode: 0o600 },
  )
  return path
}
