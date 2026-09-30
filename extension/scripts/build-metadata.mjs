import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { API_VERSION, EXTENSION_VERSION } from '../dist/constants.js'

import { readBuildIdentity } from './utils/readBuildIdentity.mjs'

const repository = fileURLToPath(new URL('../../', import.meta.url))
await writeFile(
  new URL('../dist/build.json', import.meta.url),
  JSON.stringify(
    {
      ...(await readBuildIdentity(repository)),
      extensionVersion: EXTENSION_VERSION,
      apiVersion: API_VERSION,
    },
    null,
    2,
  ),
)
