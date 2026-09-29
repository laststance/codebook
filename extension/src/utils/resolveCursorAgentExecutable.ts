import { access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** Finds the existing Cursor Agent CLI when a Wiki browser request needs the editor agent. @example await resolveCursorAgentExecutable() // => '/Users/learner/.local/bin/cursor-agent' */
export async function resolveCursorAgentExecutable(): Promise<string> {
  const installedBinary = join(homedir(), '.local', 'bin', 'cursor-agent');
  return access(installedBinary).then(() => installedBinary, () => 'cursor-agent');
}
