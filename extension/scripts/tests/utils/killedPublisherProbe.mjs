import { register } from 'node:module'
import { basename, dirname } from 'node:path'

import {
  swapBeforeReading,
  swapBeforeRenaming,
  swapBeforeWriting,
} from './swappedFolderFileSystem.mjs'

/**
 * Runs one step of the shipped publisher in a process of its own and kills that process at a point the test names, as a learner's closed terminal or a crashed editor stops it there. The point is a chain of calls, each `{ call, folder, name }`: the call (`writing`, an `open` to write or a `writeFile`; `reading`, a `readFile`; `renaming`, a `rename` by its source) of a file directly in `folder` whose name matches the regular expression `name`. The first step is waited for from the start, each later one from the moment the step before it was reached, and the process is killed just before the last. The publisher is the copy whose `node:fs/promises` is `swappedFolderFileSystem.mjs` (the loader hook of `markedCopyHooks.mjs`, by its mark `?swapped-folder`), so the chain runs from that file system's swaps. Started by the publisher's tests with `spawnSync(process.execPath, [probe, JSON.stringify(spec)])`.
 *
 * The one argument is a JSON text: `{ operation, options, killAt }`, where `operation` is `publishWiki`, `prepareWikiStage` or `recoverWikiPublication`, `options` is what it is called with and `killAt` is the chain. The probe prints `not killed` when the step ended without reaching the point, `not killed: <message>` when it was refused before it, and nothing when it was killed there.
 * @example
 * spawnSync(process.execPath, [probe, JSON.stringify({ operation: 'publishWiki', options: { projectRoot, outputDirectory, stageDirectory }, killAt: [{ call: 'writing', folder: stageDirectory, name: 'codebook-wiki\\.json$' }] })], { encoding: 'utf8' }).stdout // => ''
 */

/** The swap of `swappedFolderFileSystem.mjs` that waits for each kind of call a step of the chain names. */
const SWAPS_BEFORE = {
  writing: swapBeforeWriting,
  reading: swapBeforeReading,
  renaming: swapBeforeRenaming,
}

/**
 * Waits for the first step of a chain, then for the rest of it from that moment on, and kills this process just before the last step.
 * @param {{ call: 'writing' | 'reading' | 'renaming', folder: string, name: string }[]} steps - The chain still to come.
 * @returns {void}
 * @example
 * armKill([{ call: 'renaming', folder: '/repo/.codebook/next', name: '^\\.codebook-publish-' }])
 */
function armKill([step, ...rest]) {
  const pattern = new RegExp(step.name)
  SWAPS_BEFORE[step.call](
    (path) => dirname(path) === step.folder && pattern.test(basename(path)),
    async () => {
      // The last step kills; an earlier one only arms the next.
      if (rest.length === 0) process.kill(process.pid, 'SIGKILL')
      else armKill(rest)
    },
  )
}

const { operation, options, killAt } = JSON.parse(process.argv[2])
register(new URL('./markedCopyHooks.mjs', import.meta.url))
const publisher =
  await import('../../../skills/codebook/publish-wiki.mjs?swapped-folder')
armKill(killAt)
// Whatever ends the step instead of the kill is printed, so a test tells it from the kill, which prints nothing.
await publisher[operation](options).then(
  () => console.log('not killed'),
  (error) => console.log(`not killed: ${error.message}`),
)
