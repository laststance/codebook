import { randomUUID } from 'node:crypto'
import { join } from 'node:path'

/**
 * Names a new file for Codebook's staged config in Cursor's settings folder: `<folder>/.codebook-<uuid>.mcp.json`; called by {@link refreshCursorMcpCatalog} for the config it stages before it links it into place, and for the empty file that reads the folder's clock ({@link readFileSystemNowMs}), which the sweep of {@link removeLeftStagedConfigs} then finds by the same name if a killed window leaves it.
 * @param cursorDirectory - Cursor's settings folder.
 * @returns The path of a file that does not exist yet, with a random UUID as {@link randomUUID} writes it.
 * @example newStagedConfigPath('/home/user/.cursor') // => '/home/user/.cursor/.codebook-123e4567-e89b-12d3-a456-426614174000.mcp.json'
 */
export function newStagedConfigPath(cursorDirectory: string): string {
  return join(cursorDirectory, `.codebook-${randomUUID()}.mcp.json`)
}
