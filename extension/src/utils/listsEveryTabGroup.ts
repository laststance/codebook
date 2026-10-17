/**
 * Says whether a tab group change lists every group of the tab model as changed, with none opened or closed: the change the extension host fires for a whole new tab model, which both editors send when a group's lock changes (Cursor 3.23.12 `workbench.desktop.main.js` 17269:31902 and 17269:31013, `extensionHostProcess.js` 131:33177; VS Code 1.140.0 725:7861 and 725:7244). A group the editor only activates comes alone (131:33740). {@link StudyWorkspace.lockActiveEditorGroup} asks it of each change while its lock runs, to name the group the lock changed (Cycle 0046 row 650).
 * @param event - The tab group change.
 * @param groups - Every group of the tab model after the change (`vscode.window.tabGroups.all`).
 * @returns
 * - `true` when every group is listed as changed and none opened or closed.
 * - `false` for a change that leaves a group out (a group activated alone), opens or closes a group, and for a tab model without groups.
 * @example
 * listsEveryTabGroup({ opened: [], closed: [], changed: [application, learner] }, [application, learner]) // => true: the whole tab model a lock sent
 * listsEveryTabGroup({ opened: [], closed: [], changed: [learner] }, [application, learner]) // => false: the learner's group activated alone
 */
export function listsEveryTabGroup<Group>(
  event: {
    readonly opened: readonly Group[]
    readonly closed: readonly Group[]
    readonly changed: readonly Group[]
  },
  groups: readonly Group[],
): boolean {
  // A group that opened or closed comes with the editor's own change of the grid, which is no lock's.
  if (event.opened.length || event.closed.length || !groups.length) return false
  return groups.every((group) => event.changed.includes(group))
}
