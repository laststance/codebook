import { realpath } from 'node:fs/promises'
import { normalize } from 'node:path'

/** The real path of a file, or its normalized spelling when the file cannot be resolved. */
async function realOrNormalized(path: string): Promise<string> {
  return realpath(path).catch(() => normalize(path))
}

/**
 * Tells whether a paused frame's source is the very file a `wxt-build` stop was declared in.
 * Why: the editor's debugger binds a breakpoint through the build's source map, and a pause can still report a frame in the bundle or in another source; the capture would then label bundle coordinates as the stop's TypeScript (D18).
 * Called by the extension debugger for the top frame of every declared pause of a `wxt-build` run.
 * @param framePath - The frame's `source.path` as the debug adapter reports it; `undefined` when the frame has no file.
 * @param stopPath - The stop's absolute project source path.
 * @returns `true` when both name the same file after normalizing (and resolving links); `false` for another file, a bundle, or a frame without a path.
 * @example
 * await isFrameInStopSource('/repo/ext/src/App.tsx', '/repo/ext/src/App.tsx') // => true
 * await isFrameInStopSource('/tmp/run/chunks/options.js', '/repo/ext/src/App.tsx') // => false
 */
export async function isFrameInStopSource(
  framePath: string | undefined,
  stopPath: string,
): Promise<boolean> {
  if (framePath === undefined || framePath === '') return false
  if (normalize(framePath) === normalize(stopPath)) return true
  // A link or a differently spelled folder can name the same file.
  return (
    (await realOrNormalized(framePath)) === (await realOrNormalized(stopPath))
  )
}
