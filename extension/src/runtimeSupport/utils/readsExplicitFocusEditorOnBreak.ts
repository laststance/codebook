/**
 * Says whether the learner or a project set `debug.focusEditorOnBreak` explicitly, which ends Codebook's contributed default.
 * Codebook contributes `false` through `configurationDefaults`, which `inspect` reports as `defaultValue` and which is not an explicit layer. A value in the user, workspace or workspace-folder layer is the learner's own choice and is left alone, even when it is `false`.
 * Called by the keyboard hand-over of {@link StudyWorkspace} before it gives a paused file the keyboard.
 *
 * @param inspection - The result of `inspect('focusEditorOnBreak')` on the `debug` configuration; `undefined` when the setting is not registered.
 * @returns
 * - `true` when a user, workspace or workspace-folder layer holds a value
 * - `false` for the contributed default alone, and for no inspection
 * @example
 * readsExplicitFocusEditorOnBreak({ key: 'debug.focusEditorOnBreak', defaultValue: false, globalValue: false }) // => true
 * readsExplicitFocusEditorOnBreak({ key: 'debug.focusEditorOnBreak', defaultValue: false }) // => false
 */
export function readsExplicitFocusEditorOnBreak(
  inspection:
    | {
        defaultValue?: unknown
        globalValue?: unknown
        workspaceValue?: unknown
        workspaceFolderValue?: unknown
      }
    | undefined,
): boolean {
  if (!inspection) return false
  return [
    inspection.globalValue,
    inspection.workspaceValue,
    inspection.workspaceFolderValue,
  ].some((layerValue) => layerValue !== undefined)
}
