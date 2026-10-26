import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Where {@link resolveCursorAgentExecutable} looks for the Cursor Agent CLI, in its order, as the learner reads it; a sentence that names the lookup takes it from here, so the two cannot drift apart (/ship review, Cycle 0055 pt1). */
export const CURSOR_AGENT_LOOKUP_DESCRIPTION =
  "~/.local/bin/cursor-agent, then cursor-agent on the editor's PATH"

/** Finds the existing Cursor Agent CLI when a Wiki browser request needs the editor agent: {@link CURSOR_AGENT_LOOKUP_DESCRIPTION}. @example await resolveCursorAgentExecutable() // => '/Users/learner/.local/bin/cursor-agent' */
export async function resolveCursorAgentExecutable(): Promise<string> {
  const installedBinary = join(homedir(), '.local', 'bin', 'cursor-agent')
  return access(installedBinary).then(
    () => installedBinary,
    () => 'cursor-agent',
  )
}
