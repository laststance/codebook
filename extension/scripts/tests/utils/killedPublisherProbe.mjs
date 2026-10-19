import { register } from 'node:module'

import {
  swapBeforeReading,
  swapBeforeWriting,
} from './swappedFolderFileSystem.mjs'

/**
 * Runs one step of the shipped publisher in a process of its own and kills that process at a point the test names, as a learner's closed terminal or a crashed editor stops it there: just before the publisher writes the first file whose path starts with `killBeforeWriting` (a path, or the start of one whose end is a random id), or, when `killBeforeReadingAfterIt` is given too, just before the first read of a file whose path starts with that after the write began. The publisher is the copy whose `node:fs/promises` is `swappedFolderFileSystem.mjs` (the loader hook of `markedCopyHooks.mjs`, by its mark `?swapped-folder`), so the kill runs from that file system's swap. Started by the publisher's tests with `spawnSync(process.execPath, [probe, JSON.stringify(spec)])`.
 *
 * The one argument is a JSON text: `{ operation, options, killBeforeWriting, killBeforeReadingAfterIt? }`, where `operation` is `publishWiki`, `prepareWikiStage` or `recoverWikiPublication` and `options` is what it is called with. The probe prints `not killed` when the step ended without reaching the point, `not killed: <message>` when it was refused before it, and nothing when it was killed there.
 * @example
 * spawnSync(process.execPath, [probe, JSON.stringify({ operation: 'publishWiki', options: { projectRoot, outputDirectory, stageDirectory }, killBeforeWriting: join(stageDirectory, 'codebook-wiki.json') })], { encoding: 'utf8' }).stdout // => ''
 */
const { operation, options, killBeforeWriting, killBeforeReadingAfterIt } =
  JSON.parse(process.argv[2])
register(new URL('./markedCopyHooks.mjs', import.meta.url))
const publisher =
  await import('../../../skills/codebook/publish-wiki.mjs?swapped-folder')
const kill = () => process.kill(process.pid, 'SIGKILL')
swapBeforeWriting(
  (path) => path.startsWith(killBeforeWriting),
  async () => {
    // Killed at once, or at the first read of the named file after this write.
    if (killBeforeReadingAfterIt === undefined) kill()
    else
      swapBeforeReading(
        (path) => path.startsWith(killBeforeReadingAfterIt),
        async () => kill(),
      )
  },
)
// Whatever ends the step instead of the kill is printed, so a test tells it from the kill, which prints nothing.
await publisher[operation](options).then(
  () => console.log('not killed'),
  (error) => console.log(`not killed: ${error.message}`),
)
