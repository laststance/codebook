import { z } from 'zod'

import { DEVIN_MCP_RECORD_LIMIT_BYTES } from '../constants'
import { DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE } from '../devinWindowSentences'

import { atomicPrivateWrite } from './atomicPrivateWrite'
import { readDescriptorText } from './readDescriptorText'

const descriptorSchema = z.record(z.string(), z.unknown())

/**
 * Sets or drops `devinChat` in this window's connection descriptor, so the Devin bridge can tell a window where Set Up AI Chat ran from one where it did not; called by the Devin Desktop setup once its setup is saved and by its removal.
 * Every other field stays as written; the file is replaced whole, never half written. The file is read with {@link readDescriptorText}: a link, a pipe or a file over the size cap is refused unread.
 * @param descriptorPath - The window's `<instance>.connection.json` in the agent folder.
 * @param enabled - `true` writes `"devinChat": true`; `false` removes the field and the installation mark.
 * @param installationId - The installation id of the MCP receipt the mark is made for; written as `devinSetupInstallation` beside `devinChat` when `enabled`, so a bridge can tell a removed setup from an updated one. Left out, no installation is named and the Devin bridge refuses the descriptor.
 * @param token - The next bearer token ({@link startServer}'s `prepareTokenRotation`), written in place of the one in the file only when this rewrite removes a mark (the file carried `devinChat: true` and `enabled` is `false`): a window that was never marked has no Devin bridge to stop and keeps its token. The field stays as written otherwise.
 * @returns Whether the file now carries `token`; the caller switches the server to it only then.
 * @throws When the descriptor is gone or cannot be replaced; for a file that is no JSON object only {@link DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE}, because the descriptor holds the bearer token and a parser's message quotes part of the file.
 * @example
 * await setDescriptorDevinChat('/storage/agent/instance-1.connection.json', true)
 */
export async function setDescriptorDevinChat(
  descriptorPath: string,
  enabled: boolean,
  installationId?: string,
  token?: string,
): Promise<boolean> {
  // The bounded read (no link followed, no wait on a pipe, regular and size-capped) keeps the descriptor queue from holding on a hostile path.
  const text = await readDescriptorText(descriptorPath).catch(
    (error: unknown) => {
      // A descriptor that is gone stays the file system's own error; anything else the path holds is unreadable.
      if ((error as { code?: unknown }).code === 'ENOENT') throw error
      throw new Error(DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE)
    },
  )
  let fields: z.infer<typeof descriptorSchema>
  try {
    fields = descriptorSchema.parse(JSON.parse(text))
  } catch {
    // Neither the parser's nor the schema's message is passed on: either can quote the file.
    throw new Error(DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE)
  }
  const {
    devinChat: previous,
    devinSetupInstallation: _previousInstallation,
    ...rest
  } = fields
  // Only the removal of a mark rotates the token: no Devin bridge can hold it otherwise.
  const writesToken = Boolean(token) && !enabled && previous === true
  await atomicPrivateWrite(
    descriptorPath,
    enabled
      ? {
          ...rest,
          devinChat: true,
          ...(installationId && { devinSetupInstallation: installationId }),
        }
      : { ...rest, ...(writesToken && { token }) },
    DEVIN_MCP_RECORD_LIMIT_BYTES,
  )
  return writesToken
}
