import { z } from 'zod'

import {
  EXPO_WEB_API_SERVER_MINIMUM_API,
  VITE_API_SERVER_MINIMUM_API,
} from './constants'
import {
  addNodeLoaderIssue,
  nodeEntrySchema,
  nodeLoaderSchema,
  nodePackageFolderSchema,
  nodeServerPortSchema,
} from './nodeLaunchSchemas'

/**
 * The optional `apiServer` declaration of a version 3 `expo-web-dev` (MCP API 1.37) or `vite-dev` (API 1.38) configuration: the app's own Node API server, which Codebook starts beside the dev server so a server stop in the API pauses during the request a page operation sends.
 * Only the shape is checked here; the folder, stop, participant and `proxyPaths` rules that need the whole configuration live in `validateApiServer` of the repository configuration schemas. `loader` stays optional and untransformed so the retained configuration keeps its exact parsed shape.
 * Read by the version 3 repository-browser configuration; every adapter but those two and every older version refuses the key as unknown.
 * @example
 * apiServerDeclarationSchema.parse({ packageRoot: 'services/api', entry: 'src/server.ts', port: 4100 }) // => same object
 */
export const apiServerDeclarationSchema = z
  .strictObject({
    packageRoot: nodePackageFolderSchema.describe(
      `The API package's folder, relative to the repository (for example "apps/api"); never equal to or around the app's folder (under vite-dev it may lie inside the app's folder; under expo-web-dev it lies outside). API ${EXPO_WEB_API_SERVER_MINIMUM_API} (expo-web-dev), ${VITE_API_SERVER_MINIMUM_API} (vite-dev).`,
    ),
    entry: nodeEntrySchema.describe(
      'The API entry file, relative to apiServer.packageRoot, as its package runs it (for example "src/server.ts").',
    ),
    loader: nodeLoaderSchema,
    port: nodeServerPortSchema,
    proxyPaths: z
      .array(z.string())
      .optional()
      .describe(
        `vite-dev only (API ${VITE_API_SERVER_MINIMUM_API}): 1 to 8 path prefixes the dev server forwards to the API, each starting with "/" and without a trailing "/" ("/api", not "/api/"). Lets Codebook tie a page request to the dev server's own origin to a server stop. Refused under expo-web-dev.`,
      ),
  })
  .superRefine(addNodeLoaderIssue)
  .describe(
    `Optional (API ${EXPO_WEB_API_SERVER_MINIMUM_API} under expo-web-dev, ${VITE_API_SERVER_MINIMUM_API} under vite-dev). The app's own Node API server in the same repository: Codebook starts it beside the dev server (node with an inspector and the repository's own tsx, setting no variable), attaches the server participant to it and pauses server stops during the page's request. Without it participant "server" is refused.`,
  )
