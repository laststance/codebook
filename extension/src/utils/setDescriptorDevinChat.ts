import { readFile } from 'node:fs/promises'

import { z } from 'zod'

import { DEVIN_MCP_RECORD_LIMIT_BYTES } from '../constants'

import { atomicPrivateWrite } from './atomicPrivateWrite'

const descriptorSchema = z.record(z.string(), z.unknown())

/**
 * Sets or drops `devinChat` in this window's connection descriptor, so the Devin bridge can tell a window where Set Up AI Chat ran from one where it did not; called by the Devin Desktop setup once its setup is saved and by its removal.
 * Every other field stays as written; the file is replaced whole, never half written.
 * @param descriptorPath - The window's `<instance>.connection.json` in the agent folder.
 * @param enabled - `true` writes `"devinChat": true`; `false` removes the field.
 * @throws When the descriptor is gone, is not a JSON object or cannot be replaced.
 * @example
 * await setDescriptorDevinChat('/storage/agent/instance-1.connection.json', true)
 */
export async function setDescriptorDevinChat(
  descriptorPath: string,
  enabled: boolean,
): Promise<void> {
  const { devinChat: _previous, ...rest } = descriptorSchema.parse(
    JSON.parse(await readFile(descriptorPath, 'utf8')),
  )
  await atomicPrivateWrite(
    descriptorPath,
    enabled ? { ...rest, devinChat: true } : rest,
    DEVIN_MCP_RECORD_LIMIT_BYTES,
  )
}
