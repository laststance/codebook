/** The accessor name of a V8 setter frame line (`at set closing (…)`, also with a receiver or an alias); `undefined` for any other frame. */
const SETTER_FRAME = /^\s*at (?:[\w$]+\.)?set ([\w$]+)(?: \[as [\w$]+\])? \(/

/**
 * Says whether a V8 stack frame line is a Study workspace part's host setter: the setter that forwards one marker to the workspace's own setter of the same name, and so stands between that setter and the part method that assigned it.
 *
 * Called by `StudyWorkspace.noteMarker` to skip that frame when naming the owner of a control-refusing marker. It compares accessor names, never file names: the packaged extension is one bundle (`dist/extension.js`), so a host setter's frame names no `studyWorkspace/<part>Host.js` there.
 *
 * @param frame - The stack frame line right below the marker's own setter.
 * @param markerSetterFrame - The frame line of the workspace's marker setter.
 * @returns `true` when `frame` is a setter of the same accessor as `markerSetterFrame`; `false` for a method frame and for another accessor's setter.
 * @example
 * isWorkspaceHostSetterFrame(
 *   'at set closing (/ext/dist/extension.js:20:5)',
 *   'at set closing (/ext/dist/extension.js:10:5)',
 * ) // => true
 * isWorkspaceHostSetterFrame('at StudyWorkspace.open (/ext/dist/extension.js:30:5)', 'at set closing (/ext/dist/extension.js:10:5)') // => false
 */
export function isWorkspaceHostSetterFrame(
  frame: string,
  markerSetterFrame: string,
): boolean {
  const accessor = SETTER_FRAME.exec(markerSetterFrame)?.[1]
  // Only a setter of the marker's own accessor forwards it; a workspace setter that assigns another marker is that marker's owner.
  return accessor !== undefined && SETTER_FRAME.exec(frame)?.[1] === accessor
}
