import { z } from 'zod'

import { EXPO_WEB_API_SERVER_MINIMUM_API } from './constants'
import {
  addNodeLoaderIssue,
  nodeEntrySchema,
  nodeLoaderSchema,
  nodePackageFolderSchema,
  nodeServerPortSchema,
} from './nodeLaunchSchemas'

/**
 * The optional `apiServer` declaration of a version 3 `expo-web-dev` configuration (MCP API 1.37): the app's own Node API server, which Codebook starts beside Metro so a server stop in the API pauses during the request a page operation sends.
 * Only the shape is checked here; the folder, stop and participant rules that need the whole configuration live in `validateApiServer` of the repository configuration schemas. `loader` stays optional and untransformed so the retained configuration keeps its exact parsed shape.
 * Read by the version 3 repository-browser configuration; every other adapter and version refuses the key as unknown.
 * @example
 * apiServerDeclarationSchema.parse({ packageRoot: 'services/api', entry: 'src/server.ts', port: 4100 }) // => same object
 */
export const apiServerDeclarationSchema = z
  .strictObject({
    packageRoot: nodePackageFolderSchema.describe(
      `The API package's folder, relative to the repository (for example "apps/api"); outside the app's folder and not containing it. API ${EXPO_WEB_API_SERVER_MINIMUM_API}.`,
    ),
    entry: nodeEntrySchema.describe(
      'The API entry file, relative to apiServer.packageRoot, as its package runs it (for example "src/server.ts").',
    ),
    loader: nodeLoaderSchema,
    port: nodeServerPortSchema,
  })
  .superRefine(addNodeLoaderIssue)
  .describe(
    `Optional (API ${EXPO_WEB_API_SERVER_MINIMUM_API}). The app's own Node API server in the same repository: Codebook starts it beside Metro (node with an inspector and the repository's own tsx, setting no variable), attaches the server participant to it and pauses server stops during the page's request. Without it participant "server" is refused.`,
  )
