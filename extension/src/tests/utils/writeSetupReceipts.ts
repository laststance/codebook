import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { INSTALLATION_ID } from './INSTALLATION_ID'

/**
 * Writes the two receipts a Devin Desktop setup leaves in the global storage folder (the parent of the agent folder): the skill's and the MCP entry's, which carries the installation id.
 * @param storageRoot - The global storage folder.
 * @param overrides - Fields that replace those of the MCP receipt; `installed: false` makes a removed one.
 */
export async function writeSetupReceipts(
  storageRoot: string,
  overrides: Record<string, unknown> = {},
  skillInstalled = true,
): Promise<void> {
  await mkdir(join(storageRoot, 'devin-skill'), { recursive: true })
  await mkdir(join(storageRoot, 'devin-mcp'), { recursive: true })
  await writeFile(
    join(storageRoot, 'devin-skill', 'receipt.json'),
    JSON.stringify({ installed: skillInstalled }),
    { mode: 0o600 },
  )
  await writeFile(
    join(storageRoot, 'devin-mcp', 'receipt.json'),
    JSON.stringify({
      installed: true,
      installationId: INSTALLATION_ID,
      ...overrides,
    }),
    { mode: 0o600 },
  )
}
