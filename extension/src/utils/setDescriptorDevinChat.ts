import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import { DEVIN_MCP_RECORD_LIMIT_BYTES } from '../constants'
import { DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE } from '../devinWindowSentences'

import { atomicPrivateWrite } from './atomicPrivateWrite'

const descriptorSchema = z.record(z.string(), z.unknown())

/**
 * Sets or drops `devinChat` in this window's connection descriptor, so the Devin bridge can tell a window where Set Up AI Chat ran from one where it did not; called by the Devin Desktop setup once its setup is saved and by its removal.
 * Every other field stays as written; the file is replaced whole, never half written.
 * @param descriptorPath - The window's `<instance>.connection.json` in the agent folder.
 * @param enabled - `true` writes `"devinChat": true`; `false` removes the field.
 * @throws When the descriptor is gone or cannot be replaced; for a file that is no JSON object only {@link DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE}, because the descriptor holds the bearer token and a parser's message quotes part of the file.
 * @example
 * await setDescriptorDevinChat('/storage/agent/instance-1.connection.json', true)
 */
export async function setDescriptorDevinChat(
  descriptorPath: string,
  enabled: boolean,
): Promise<void> {
  const text = await readFile(descriptorPath, 'utf8')
  let fields: z.infer<typeof descriptorSchema>
  try {
    fields = descriptorSchema.parse(JSON.parse(text))
  } catch {
    // Neither the parser's nor the schema's message is passed on: either can quote the file.
    throw new Error(DEVIN_DESCRIPTOR_UNREADABLE_SENTENCE)
  }
  const { devinChat: _previous, ...rest } = fields
  await atomicPrivateWrite(
    descriptorPath,
    enabled ? { ...rest, devinChat: true } : rest,
    DEVIN_MCP_RECORD_LIMIT_BYTES,
  )
}
