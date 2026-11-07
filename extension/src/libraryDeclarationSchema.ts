import { z } from 'zod'

import { repositoryPathSchema } from './sourceSchemas'

/**
 * The shape of the optional `library` declaration of a `node-script` configuration (MCP API 1.33) and of a nested version 3 `vite-dev` configuration (API 1.34): the repository's own library package the Example should run on.
 * Only the shape is checked here; whether the folder is a real package inside the repository, a dependency of the Example and outside it is the library build's refusal (`LIBRARY_BUILD_UNSUPPORTED`).
 * Read by {@link nodeScriptConfigSchema} and by the version 3 repository-browser configuration, so both runtimes accept one shape.
 * @example
 * libraryDeclarationSchema.parse({ packageRoot: 'packages/toolkit' }) // => { packageRoot: 'packages/toolkit' }
 */
export const libraryDeclarationSchema = z
  .strictObject({
    packageRoot: z
      .union([z.literal('.'), repositoryPathSchema])
      .describe(
        'The folder of the repository\'s own library package, relative to the repository root ("." or a folder such as "packages/toolkit"). Codebook builds and packs it with the repository\'s package manager so the Example runs on the checked-out library instead of its installed copy.',
      ),
  })
  .describe(
    "Optional. Run the Example on the library package of the opened repository (built and packed by Codebook) instead of the copy installed in the Example's node_modules.",
  )
