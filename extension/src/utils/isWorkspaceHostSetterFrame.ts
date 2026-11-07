/**
 * Says whether a V8 stack frame line belongs to a Study workspace part's host setter (`studyWorkspace/<part>Host.js`), which stands between a marker's setter and the part method that assigned it.
 *
 * Called by `StudyWorkspace.noteMarker` to skip that frame when naming the owner of a control-refusing marker. The path separator is matched as `/` or `\` because V8 prints Windows paths with backslashes; only compiled `.js` is matched because the extension runs `dist/*.js`.
 *
 * @param frame - One line of `Error.stack`.
 * @returns `true` when the frame is inside a part's host file.
 * @example isWorkspaceHostSetterFrame('at x (C:\\ext\\dist\\studyWorkspace\\replayOpeningHost.js:1:1)') // => true
 */
export function isWorkspaceHostSetterFrame(frame: string): boolean {
  return /studyWorkspace[\\/]\w+Host\.js/.test(frame)
}
