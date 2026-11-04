import type { LibraryPackage } from './libraryBuildStop'
import type { ViteLibraryModuleSource } from './selectViteLibraryCandidate'

/** The place a stop is declared at: the key a run keeps its per-stop library facts under. */
type StopPlace = Readonly<{ path: string; line: number; column: number }>

/**
 * Keeps what a nested Vite run knows about its library stops: which declared stop lies in which workspace library, and one module source per page generation and library folder.
 *
 * Why it exists: {@link ConfiguredBrowserRun} is already very large; the registry holds the Vite library state (decision D13: all library stops of one page generation share one walk per library folder) so the run only asks it. Created once per run; written by the run's package resolution and read by the seal, the arming and the integrity checks.
 * @example
 * const registry = new ViteLibraryRegistry()
 * registry.register({ path: 'packages/core/src/a.ts', line: 3, column: 1 }, library)
 * registry.libraryOf({ path: 'packages/core/src/a.ts', line: 3, column: 1 })?.name // => '@scope/core'
 */
export class ViteLibraryRegistry {
  private readonly libraries = new Map<string, LibraryPackage>()
  private readonly moduleSources = new Map<string, ViteLibraryModuleSource>()

  /** Keys a stop by its declared place. @example ViteLibraryRegistry.keyOf({ path: 'a.ts', line: 3, column: 1 }) // 'a.ts:3:1' */
  private static keyOf(place: StopPlace): string {
    return `${place.path}:${place.line}:${place.column}`
  }

  /**
   * Records that a declared stop lies in a workspace library the app reaches.
   * @param place - The stop's declared place.
   * @param library - The library holding the stop file.
   * @example registry.register(stop.source, library)
   */
  register(place: StopPlace, library: LibraryPackage): void {
    this.libraries.set(ViteLibraryRegistry.keyOf(place), library)
  }

  /**
   * Gives the library a declared stop lies in.
   * @param place - The stop's declared place.
   * @returns The library, or `undefined` for a stop inside the app.
   * @example registry.libraryOf(stop.source)?.name // => '@scope/core'
   */
  libraryOf(place: StopPlace): LibraryPackage | undefined {
    return this.libraries.get(ViteLibraryRegistry.keyOf(place))
  }

  /**
   * Gives the module source of one library for one page generation, creating it on first use so every stop of that generation shares one walk.
   * @param generation - The page generation (0 for the first seal).
   * @param library - The library.
   * @param create - Builds the source when this generation has none for the library.
   * @returns The shared source.
   * @example registry.moduleSourceFor(0, library, () => createViteLibraryModuleSource(request))
   */
  moduleSourceFor(
    generation: number,
    library: LibraryPackage,
    create: () => ViteLibraryModuleSource,
  ): ViteLibraryModuleSource {
    const key = `${generation}|${library.realFolder}`
    let source = this.moduleSources.get(key)
    if (!source) {
      source = create()
      this.moduleSources.set(key, source)
    }
    return source
  }
}
