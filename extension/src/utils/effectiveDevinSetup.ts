/** The saved Devin Desktop setup of one window, as `workspaceState` holds it under `codebook.aiChatSetup`: a committed value is `{ workspace }`; a run in progress writes `{ workspace, provisional: true, previous }`, where `previous` is the committed setup from before the run (or none). */
export type EffectiveDevinSetup = { workspace: string }

/**
 * Reads the setup a saved value stands for, so a run that failed half-way (its provisional value could not be rolled back) never counts as a setup.
 * Called by every reader of the saved setup (the workspace match, the receipts guard, a later run's previous setup and the activation reconnect); the run's own window passes `includeProvisional` while the run lasts.
 * @param value - What `workspaceState` holds.
 * @param includeProvisional - Counts a provisional value's own workspace (the run's own window while the run lasts).
 * @returns The committed setup, or `undefined` when none stands.
 * @example
 * effectiveDevinSetupOf({ workspace: '/w', provisional: true, previous: { workspace: '/v' } }) // => { workspace: '/v' }
 * effectiveDevinSetupOf({ workspace: '/w', provisional: true }) // => undefined
 */
export function effectiveDevinSetupOf(
  value: unknown,
  includeProvisional = false,
): EffectiveDevinSetup | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const workspace = 'workspace' in value ? value.workspace : undefined
  if (typeof workspace !== 'string') return undefined
  const isProvisional = 'provisional' in value && value.provisional === true
  // A provisional value reads as what stood before its run.
  if (isProvisional && !includeProvisional)
    return effectiveDevinSetupOf(
      'previous' in value ? value.previous : undefined,
    )
  return { workspace }
}
