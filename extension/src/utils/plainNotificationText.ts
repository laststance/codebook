/**
 * Makes a sentence safe for a non-modal editor notification when part of it comes from outside Codebook: a browser link's query, a file or folder name, a setting, an error that quotes a path.
 *
 * Why: the editor turns `[label](command:…)`, `[label](https://…)` and `[label](file:…)` in such a notification into a link, and a click on a command link runs that command with the link's arguments. A citation link opened from any web page could so plant a link of its own wording in Codebook's error message.
 * Trigger: every non-modal notification of the extension that interpolates outside text passes its whole message through here before it is shown.
 *
 * @param message - The sentence as Codebook wrote it, with the outside text inside.
 * @returns The same sentence with a space between every `]` and a following `(`, which is all the editor's link pattern needs to no longer match; the text stays readable.
 *
 * @example
 * ```ts
 * plainNotificationText("ENOENT: no such file, realpath '/repo/[Open](command:x)'")
 * // => "ENOENT: no such file, realpath '/repo/[Open] (command:x)'"
 * ```
 */
export function plainNotificationText(message: string): string {
  return message.replaceAll('](', '] (')
}
