/**
 * Lists the shell commands a workflow runs, one per line of every `run` key, so a pin reads commands and never comments.
 *
 * Used by the script test that compares a workflow with a manifest (`workflowPins.test.mjs`).
 *
 * @param definition - The text of a workflow or of a composite action.
 * @returns The trimmed command lines in file order; empty when the file runs no command.
 * @example
 * runCommandsOf('      - run: |\n          npm ci\n          node check.mjs\n') // => ['npm ci', 'node check.mjs']
 */
export function runCommandsOf(definition) {
  const lines = definition.split('\n'),
    commands = []
  for (let index = 0; index < lines.length; index += 1) {
    const run = /^(\s*(?:- )?)run:\s*(.*)$/.exec(lines[index])
    if (!run) continue
    const [, lead, inline] = run
    // A command on the key's own line is the whole step.
    if (!/^[|>][+-]?$/.test(inline)) {
      commands.push(inline)
      continue
    }
    // A block: its lines are indented deeper than the `run` key and end at the next key or step.
    while (
      index + 1 < lines.length &&
      (lines[index + 1].trim() === '' ||
        lines[index + 1].search(/\S/) > lead.length)
    ) {
      index += 1
      if (lines[index].trim() !== '') commands.push(lines[index].trim())
    }
  }
  return commands
}
