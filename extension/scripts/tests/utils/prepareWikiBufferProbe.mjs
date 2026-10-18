import { readFile } from 'node:fs/promises'
import { register } from 'node:module'
import { join } from 'node:path'
import { setImmediate } from 'node:timers/promises'

import {
  observeFileReads,
  swapBeforeMaking,
  swapBeforeWriting,
} from './swappedFolderFileSystem.mjs'

// The publisher regression starts this isolated process with --expose-gc.
if (typeof global.gc !== 'function')
  throw new Error('The buffer probe needs --expose-gc.')
const [projectRoot, outputDirectory, stageDirectory] = process.argv.slice(2)
const { assets } = JSON.parse(
  await readFile(join(outputDirectory, 'codebook-wiki.json'), 'utf8'),
)
const sourceAssets = new Set(assets.map((path) => join(outputDirectory, path)))
register(new URL('./markedCopyHooks.mjs', import.meta.url))
const { prepareWikiStage } =
  await import('../../../skills/codebook/publish-wiki.mjs?swapped-folder')
const references = []
let copying = false,
  readsAtFirstWrite,
  liveBuffersAtLastWrite
const stop = observeFileReads((path, bytes) => {
  // Inventory checks precede stage creation; measure only the asset copy pass.
  if (copying && sourceAssets.has(path)) references.push(new WeakRef(bytes))
})
swapBeforeMaking(
  (path) => path === stageDirectory,
  async () => {
    copying = true
  },
)
swapBeforeWriting(
  (path) => path === join(stageDirectory, assets[0]),
  async () => {
    readsAtFirstWrite = references.length
    swapBeforeWriting(
      (path) => path === join(stageDirectory, assets.at(-1)),
      async () => {
        // Separate jobs release WeakRef's temporary keep-alive; two full collections remove unreachable buffers.
        await setImmediate()
        global.gc()
        await setImmediate()
        global.gc()
        liveBuffersAtLastWrite = references.filter(
          (reference) => reference.deref() !== undefined,
        ).length
        copying = false
      },
    )
  },
)
try {
  await prepareWikiStage({ projectRoot, outputDirectory, stageDirectory })
  console.log(
    JSON.stringify({
      readsAtFirstWrite,
      liveBuffersAtLastWrite,
      copiedAssets: references.length,
    }),
  )
} finally {
  stop()
}
