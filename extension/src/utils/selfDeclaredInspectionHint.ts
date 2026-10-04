/** Lists the names one declaration head binds: a plain name, or the targets of an object or array pattern. @example declaredNames('{ user, id: userId }') // ['user', 'userId'] */
function declaredNames(head: string): string[] {
  return head
    .split(/[{}[\],]/)
    .map((piece) => {
      const element = piece.trim().replace(/^\.\.\./, '')
      // In a pattern `key: name` binds the name; a plain declaration's `name: Type` binds the part before the colon.
      const [first = '', second] = element.split(':').map((part) => part.trim())
      return /^[{[]/.test(head.trim()) && second !== undefined ? second : first
    })
    .filter((name) => /^[A-Za-z_$][\w$]*$/.test(name))
}

/**
 * Tells the editor agent why a required inspection had no value when the stopped line itself declares that binding, called by {@link ConfiguredBrowserRun} when it words that failure.
 * The debugger pauses before the line runs, so a `const` or `let` it declares is not initialized yet; the agent cannot see that from "unavailable".
 * @param source - The sealed original source of the stop.
 * @param line - The 1-based line the debugger paused on.
 * @param inspectionPath - The inspection's path; its first segment is the binding.
 * @returns
 * - When that line declares the binding with `const` or `let`: one sentence naming the line and the fix, beginning with a space
 * - Otherwise: `''`
 * @example
 * selfDeclaredInspectionHint('const user = await getUser(email)', 1, 'user')
 * // => ' Line 1 declares user, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.'
 * selfDeclaredInspectionHint('return user', 1, 'user') // => ''
 */
export function selfDeclaredInspectionHint(
  source: string,
  line: number,
  inspectionPath: string,
): string {
  const lineText = source.split(/\r\n?|\n/)[line - 1] ?? '',
    binding = inspectionPath.split('.')[0] ?? ''
  // The head of the declaration ends at its initializer; a `var` is hoisted and readable as undefined, so it is no case.
  const head = /\b(?:const|let)\s+([^=;]+?)\s*=(?!=)/.exec(lineText)?.[1]
  if (!head || !declaredNames(head).includes(binding)) return ''
  return ` Line ${line} declares ${binding}, so it has no value yet when the debugger pauses before that line runs; declare the stop on a later line or require a value that already exists there.`
}
