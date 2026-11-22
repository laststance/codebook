import type { DevinMcpRemovalResult } from '../devinMcpConfig'

/**
 * Words what a rollback's entry removal left behind, so the rollback is not reported complete while an installed receipt, a private copy or an edited entry stays; called by the Devin setup's rollback with the removal's resolved result.
 * @param removal - What the entry removal resolved with.
 * @returns The Output line, or `undefined` when nothing stayed (the entry is gone, or it is no longer this setup's).
 * @example
 * devinRollbackLeftoverLine({ status: 'removed', path: '/c.json', cleanupFailure: 'Delete /r.json by hand.' }) // => 'Codebook took back the Devin Desktop MCP entry this setup wrote, but files stayed: Delete /r.json by hand.'
 */
export function devinRollbackLeftoverLine(
  removal: DevinMcpRemovalResult,
): string | undefined {
  if (removal.status === 'changed')
    return `Codebook left the Devin Desktop MCP entry this setup wrote in ${removal.path}: it was edited after setup.`
  if (
    (removal.status === 'removed' || removal.status === 'file-removed') &&
    removal.cleanupFailure
  )
    return `Codebook took back the Devin Desktop MCP entry this setup wrote, but files stayed: ${removal.cleanupFailure}`
  return undefined
}
