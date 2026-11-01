/** What {@link ownedChromeArguments} needs to name one Codebook-spawned Chrome. */
export type OwnedChromeArgumentOptions = {
  /** The user-data-dir the browser opens; never the learner's own profile. */
  profile: string
  /** `port` opens a random debugging port (the extension run); `pipe` talks over file descriptors 3 and 4 and exposes no port. */
  debugging: 'pipe' | 'port'
  /** `true` for a browser nobody watches; `false` for one the learner types into. */
  headless: boolean
  /** The first page. */
  startUrl: string
  /** Caps `--disk-cache-size` when set, so a saved-session folder keeps cookies and storage but little cache. */
  diskCacheBytes?: number
}

/**
 * Lists the command-line switches of a Chrome that Codebook spawns for itself: one builder for the extension run's headless browser and the saved-session setup's headed one.
 * Called by the owned extension launch and by the setup browser ({@link signInBrowserArguments}). Never `--enable-unsafe-extension-debugging`, `--load-extension` or `--disable-extensions-except`.
 * @param options - The profile folder, the debugging form, headless or not, the first page and an optional cache cap.
 * @returns The arguments after the executable.
 * @example
 * ownedChromeArguments({ profile: '/p', debugging: 'port', headless: true, startUrl: 'about:blank' })
 * // => ['--remote-debugging-port=0', '--headless=new', '--no-first-run', '--no-default-browser-check', '--user-data-dir=/p', 'about:blank']
 */
export function ownedChromeArguments(
  options: OwnedChromeArgumentOptions,
): string[] {
  return [
    options.debugging === 'port'
      ? '--remote-debugging-port=0'
      : '--remote-debugging-pipe',
    ...(options.headless ? ['--headless=new'] : []),
    '--no-first-run',
    '--no-default-browser-check',
    `--user-data-dir=${options.profile}`,
    ...(options.diskCacheBytes === undefined
      ? []
      : [`--disk-cache-size=${options.diskCacheBytes}`]),
    options.startUrl,
  ]
}
