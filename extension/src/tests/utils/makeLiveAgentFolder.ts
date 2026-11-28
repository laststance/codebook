import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { writeSetupReceipts } from './writeSetupReceipts'

/** Makes an agent folder inside a storage folder that holds the setup receipts; the caller removes the storage folder, the parent of the agent folder. */
export async function makeLiveAgentFolder(): Promise<string> {
  const storage = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-devin-bridge-live-')),
  )
  const agentDir = join(storage, 'agent')
  await mkdir(agentDir)
  await writeSetupReceipts(storage)
  return agentDir
}
