import { mkdir, mkdtemp, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeTestFolder } from './removeTestFolder'
import { writeSetupReceipts } from './writeSetupReceipts'

/** Makes an agent folder and workspace folders that are removed when the test ends. */
export async function createFolders(context: {
  after: (callback: () => Promise<void>) => void
}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), 'codebook-devin-bridge-')),
  )
  context.after(() => removeTestFolder(root))
  const agentDir = join(root, 'agent'),
    workspace = join(root, 'workspace'),
    otherWorkspace = join(root, 'other')
  await mkdir(agentDir)
  await writeSetupReceipts(root)
  await mkdir(workspace)
  await mkdir(otherWorkspace)
  return { agentDir, workspace, otherWorkspace }
}
