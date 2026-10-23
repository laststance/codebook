/**
 * Escapes the icon syntax of VS Code labels, so a recorded text such as a file path shows as written: a CodeLens title or a status bar text draws `$(name)` as an icon, and `\$(name)` as the text.
 *
 * Called by {@link StudyWorkspace} for the title of the recorded-source slot's CodeLens, whose path comes from a recording and not from Codebook.
 *
 * @param text - Text that came from a recording.
 * @returns The text with every `$(` turned into `\$(`.
 *
 * @example
 * ```ts
 * escapeCodiconSyntax('src/$(trash).ts') // => 'src/\\$(trash).ts'
 * ```
 */
export function escapeCodiconSyntax(text: string): string {
  return text.replaceAll('$(', '\\$(')
}
