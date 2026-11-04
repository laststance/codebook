import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, posix, resolve } from 'node:path'

import ts from 'typescript'

import { walkSourceMapSegments } from '../../utils/walkSourceMapSegments'

import { browserChunk, serverChunk } from './nextPagesBuildHarness'

/** The library the fixture app imports, as its `package.json` names it. */
export const LIBRARY_NAME = 'lib'

/** The repository-relative path of the library source file the stop is declared in. */
export const LIBRARY_SOURCE_PATH = 'packages/lib/src/core.ts'

/** The library source: `double` declares `doubled` on line 2 and returns it on line 3. */
export const LIBRARY_SOURCE = [
  'export function double(count: number): number {',
  '  const doubled = count * 2',
  '  return doubled',
  '}',
  '',
].join('\n')

/** The line of {@link LIBRARY_SOURCE} that returns `doubled`. */
export const LIBRARY_RETURN_LINE = 3

/** The app folder the fixture links the library into. */
export const LIBRARY_APP_FOLDER = 'examples/app'

/** How many wrapper lines Next's module wrapper puts before the built code in a `(pages-dir-node)` eval module (the generated line is the built line plus this). */
export const WRAPPER_LINE_COUNT = 2

/** How many wrapper lines the `(pages-dir-browser)` eval module of a library built file carries: E1 measured eval line 171 for built line 162 and 396 for 386, so a seal that reuses the built line as the eval line misses by this much. */
export const BROWSER_WRAPPER_LINE_COUNT = 9

/** The generated columns where the segments of a `(pages-dir-browser)` eval module's line start, as Next's inline map emits them (several per line, none at column 0 for the first). */
export const BROWSER_SEGMENT_COLUMNS = [2, 16, 30] as const

/** The generated column a browser pause reports: inside the second segment, not on a segment start (E1 saw CDP pause at mid-line columns 14 and 61). */
export const BROWSER_PAUSE_COLUMN = 19

/** The built columns the segments of a browser eval module line map. */
const BROWSER_BUILT_COLUMNS = [0, 2, 4] as const

/** How many generated lines the App Router fixture's module spends per source line, so a pause's generated line differs from its source line by more than the wrapper (the translation through the module's own map is then needed). */
const APP_GENERATED_LINES_PER_SOURCE_LINE = 2

/** The webpack layer of an eval module. */
type EvalLayer =
  'pages-dir-node' | 'pages-dir-browser' | 'app-pages-browser' | 'rsc' | 'ssr'

/** A build flavour of the library. */
export type LibraryFlavour = 'modern' | 'legacy'

/** What {@link libraryFixture} stages. */
export type LibraryFixtureSpec = {
  /** The text the builds are made from; the checked-out source by default. A different text makes the build stale. */
  builtFrom?: string
  /** The flavours written below `build/`; `modern` by default. */
  flavours?: readonly LibraryFlavour[]
  /** The flavours the page's server compile holds as modules; `modern` by default. */
  inCompile?: readonly LibraryFlavour[]
  /** The flavours the page's entry chunk (`pages/index.js`) holds as `(pages-dir-browser)` modules; none by default, so a server stop's run is unchanged. */
  inBrowser?: readonly LibraryFlavour[]
  /** Also puts a copy of the first browser flavour's module with another wrapper size into the `_app` chunk, so two entry chunks carry differing copies. */
  differingBrowserCopy?: boolean
  /** Replaces the built text of the first flavour (the map keeps the transpiled mappings), so a test can give one built line several source lines. */
  rewriteBuilt?: (built: BuiltFile) => BuiltFile
  /**
   * Stages a nested App Router app instead of a Pages one (Cycle 0080): the app gets an `app/` folder, an App paths manifest, the entry route's client reference manifest and two client chunks (`layout.js`, `page.js`) that hold the `inBrowser` flavours as `(app-pages-browser)` modules, each with the map Next writes there: one source, the library's TypeScript at the build map's entry resolved against the app's package root, with the checked-out text (E1 of Cycle 0080).
   */
  appRouter?: {
    /** Puts the top page in a route group, `app/(shop)/page.tsx`. */
    routeGroup?: boolean
    /** The flavours each client chunk holds; `inBrowser` in both by default, so the module is an identical copy in two chunks. */
    chunks?: {
      layout?: readonly LibraryFlavour[]
      page?: readonly LibraryFlavour[]
    }
    /** Gives the `page.js` copy another wrapper size, so the two chunks carry differing copies. */
    differingPageCopy?: boolean
    /** Replaces the `sources` of the module's map (absolute paths), or builds them from the path Next writes for the library, which only the staged repository knows. */
    mapSources?:
      readonly string[] | ((appResolved: string) => readonly string[])
    /** Replaces the `sourcesContent` of the module's map. */
    mapContent?: string
    /** Adds a second module to `layout.js` whose map names the same path as the library module. */
    extraNamingModule?: boolean
    /**
     * Also writes the entry route's server compile (Cycle 0081), `.next/dev/server/app/page.js`, as Next 16.2.2 writes it in E1: an `(rsc)` and an `(ssr)` module of each library flavour, each with the map Next composes (one source, the library's TypeScript at the build map's entry resolved against the app's package root, with the checked-out text). An absent field leaves the fixture byte-identical to before.
     */
    server?: {
      /** The flavours the `(rsc)` layer holds; `inBrowser` by default. */
      rsc?: readonly LibraryFlavour[]
      /** The flavours the `(ssr)` layer holds; the `(rsc)` ones by default. Empty for a compile with no `(ssr)` module. */
      ssr?: readonly LibraryFlavour[]
      /** Replaces the `sources` of the `(rsc)` module's map (absolute paths), or builds them from the path Next writes for the library. */
      mapSources?:
        readonly string[] | ((appResolved: string) => readonly string[])
      /** Replaces the `sourcesContent` of the `(rsc)` module's map. */
      mapContent?: string
      /** Adds a second `(rsc)` module under another id with the same address and another wrapper size, so the compile holds differing copies. */
      differingRscCopy?: boolean
      /** Adds another `(rsc)` module whose map names the same path as the library module. */
      extraNamingRscModule?: boolean
      /** Replaces the `(rsc)` module by the reference stub Next writes for a `'use client'` file. */
      clientStub?: boolean
    }
  }
}

/** One transpiled build file with its map. */
export type BuiltFile = { builtText: string; mapText: string }

const VLQ_DIGITS =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Encodes one signed integer as a base64 VLQ. @example vlq(1) // 'C' */
function vlq(value: number): string {
  let rest = value < 0 ? (-value << 1) | 1 : value << 1
  let digits = ''
  do {
    let digit = rest & 31
    rest >>>= 5
    if (rest > 0) digit |= 32
    digits += VLQ_DIGITS[digit]
  } while (rest > 0)
  return digits
}

/**
 * Encodes absolute segments as a map's `mappings`, so a test can write a build whose lines hold several source lines.
 * @param lines - One list of segments per generated line; each segment gives its generated column and the zero-based source line and column it maps (source index 0).
 * @returns The VLQ `mappings` text.
 * @example mappingsOf([[{ genCol: 0, srcLine: 0, srcCol: 0 }]]) // => 'AAAA'
 */
export function mappingsOf(
  lines: readonly (readonly {
    genCol: number
    srcLine: number
    srcCol: number
  }[])[],
): string {
  let srcLine = 0
  let srcCol = 0
  return lines
    .map((segments) => {
      let genCol = 0
      return segments
        .map((segment) => {
          const encoded = `${vlq(segment.genCol - genCol)}${vlq(0)}${vlq(segment.srcLine - srcLine)}${vlq(segment.srcCol - srcCol)}`
          genCol = segment.genCol
          srcLine = segment.srcLine
          srcCol = segment.srcCol
          return encoded
        })
        .join(',')
    })
    .join(';')
}

/**
 * Transpiles the library source with TypeScript, as a library's own build does: the built file ends with its `sourceMappingURL` comment, and the map names the checked-out source relative to the map's folder and carries its text.
 * @param source - The text to transpile.
 * @param flavour - `modern` (ES2022) or `legacy` (ES5), which differ in their lines.
 * @returns The built text and the map text.
 * @example buildLibraryFile(LIBRARY_SOURCE, 'modern').builtText.includes('doubled') // => true
 */
export function buildLibraryFile(
  source: string,
  flavour: LibraryFlavour,
): BuiltFile {
  const output = ts.transpileModule(source, {
    fileName: 'core.ts',
    compilerOptions: {
      target:
        flavour === 'modern' ? ts.ScriptTarget.ES2022 : ts.ScriptTarget.ES5,
      module: ts.ModuleKind.ESNext,
      sourceMap: true,
      inlineSources: true,
    },
  })
  const map = JSON.parse(output.sourceMapText ?? '{}')
  return {
    builtText: output.outputText,
    mapText: JSON.stringify({
      ...map,
      file: 'core.js',
      sources: ['../../src/core.ts'],
      sourceRoot: '',
    }),
  }
}

/**
 * Builds the text of the webpack eval module Next emits for a built library file in the server compile: wrapper lines, then one generated line per built line, an inline map whose `sources` names the absolute built file with its text as `sourcesContent`, and the `sourceURL`.
 * @param input - The real repository root, the built path, the built text, the module's runtime path and the number of wrapper lines.
 * @returns The module text.
 * @example libraryEvalModule({ realRoot, builtPath: 'packages/lib/build/modern/core.js', builtText, runtimePath: '../../packages/lib/build/modern/core.js' })
 */
export function libraryEvalModule(input: {
  realRoot: string
  builtPath: string
  builtText: string
  runtimePath: string
  wrapperLines?: number
  /** The webpack layer the module's `sourceURL` names; `pages-dir-node` by default. */
  layer?: EvalLayer
  /** How many generated lines each built line takes: the first carries the map segments, the others are unmapped. 1 by default, which keeps every Pages module line for line. */
  generatedLinesPerBuiltLine?: number
  /** Replaces the map's `sources` and `sourcesContent`. */
  mapOverride?: {
    sources?: readonly string[]
    sourcesContent?: readonly string[]
  }
}): string {
  const isBrowser =
    input.layer === 'pages-dir-browser' || input.layer === 'app-pages-browser'
  const wrapper =
    input.wrapperLines ??
    (isBrowser ? BROWSER_WRAPPER_LINE_COUNT : WRAPPER_LINE_COUNT)
  const builtLines = input.builtText.split('\n')
  const extraLines = Math.max(0, (input.generatedLinesPerBuiltLine ?? 1) - 1)
  const code = [
    ...Array.from({ length: wrapper }, () => '/* wrapper */'),
    ...builtLines.flatMap((_, index) => [
      isBrowser
        ? // Three statements per line, starting at the segment columns.
          [
            `work${index + 1}();`,
            `mid${index + 1}();`,
            `tail${index + 1}();`,
          ].reduce(
            (line, text, part) =>
              line.padEnd(BROWSER_SEGMENT_COLUMNS[part]!) + text,
            '',
          )
        : `work${index + 1}();`,
      // Lines a transpiler adds that no source line owns.
      ...Array.from(
        { length: extraLines },
        (__, extra) => `extra${index + 1}x${extra + 1}();`,
      ),
    ]),
  ].join('\n')
  let previous = 0
  let previousBuiltColumn = 0
  const segments = builtLines.flatMap((_, index) => {
    // A browser line holds several segments, none at column 0; a node line holds one at column 0.
    const columns = isBrowser ? BROWSER_SEGMENT_COLUMNS : [0]
    const line = columns
      .map((genCol, part) => {
        const builtColumn = isBrowser ? BROWSER_BUILT_COLUMNS[part]! : 0
        const segment = `${vlq(part === 0 ? genCol : genCol - columns[part - 1]!)}${vlq(0)}${vlq(part === 0 ? index - previous : 0)}${vlq(builtColumn - previousBuiltColumn)}`
        previousBuiltColumn = builtColumn
        return segment
      })
      .join(',')
    previous = index
    return [line, ...Array.from({ length: extraLines }, () => '')]
  })
  const map = {
    version: 3,
    file: '',
    sources: input.mapOverride?.sources ?? [
      join(input.realRoot, input.builtPath),
    ],
    sourcesContent: input.mapOverride?.sourcesContent ?? [input.builtText],
    names: [],
    mappings: [...Array.from({ length: wrapper }, () => ''), ...segments].join(
      ';',
    ),
    ignoreList: [],
    sourceRoot: '',
  }
  return `${code}\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n//# sourceURL=webpack-internal:///(${input.layer ?? 'pages-dir-node'})/${input.runtimePath}\n`
}

/**
 * Finds the first built line (one-based) the build map puts a source line on.
 * @param mapText - The build map text.
 * @param sourceLine - One-based source line.
 * @returns The built line, or `undefined` when the map has no segment for the line.
 * @example builtLineOfSourceLine(built.mapText, 3) // => 3
 */
export function builtLineOfSourceLine(
  mapText: string,
  sourceLine: number,
): number | undefined {
  let found: number | undefined
  walkSourceMapSegments(JSON.parse(mapText).mappings, (segment) => {
    if (
      found === undefined &&
      segment.original &&
      segment.original.line + 1 === sourceLine
    )
      found = segment.generatedLine + 1
  })
  return found
}

/** What {@link libraryFixture} gives the harness and the test. */
export type LibraryHarnessFiles = {
  /** The built path of the flavour the page's server compile holds first. */
  builtPath: string
  /** The module path Next prints for it, relative to the app. */
  runtimePath: string
  /** The built text of that flavour. */
  builtText: string
  /** The eval module text of that flavour (what the Next server's debugger reports for the script). */
  moduleJavascript: string
  /** The eval module's map. */
  moduleMap: string
  /** The eval modules the server compile holds, by module id. */
  serverModules: Record<string, string>
  /** The `(pages-dir-browser)` eval modules the page's entry chunk holds, by module id. */
  browserModules: Record<string, string>
  /** The `(pages-dir-browser)` eval modules the `_app` chunk holds, by module id (a differing copy of the page chunk's module). */
  browserAppModules: Record<string, string>
  /** The `(pages-dir-browser)` eval module of the first flavour (what the browser's debugger reports for the script). */
  browserModuleJavascript: string
  /** The `(pages-dir-browser)` address of that module. */
  browserAddress: string
  /** The real repository root the modules name. */
  realRoot: string
  /** The repository-relative file the debugger's frames name instead of {@link LibraryHarnessFiles.builtPath} (an App Router stop runs in the checked-out source). */
  frameFile?: string
  /** For an App Router fixture: the path the module's map names, and the chunks written (chunk path below `.next/dev`, then module text by module id). */
  appRouter?: { mapSource: string; chunks: Record<string, string> }
  /** For an App Router fixture with a server compile: the `(rsc)` and `(ssr)` modules and addresses of the first server flavour, the hit a server pause at a source line makes, and the server chunk's path below `.next/dev`. */
  appRouterServer?: {
    rscJavascript: string
    ssrJavascript: string
    rscAddress: string
    ssrAddress: string
    chunkPath: string
    /** The pause at a source line in the `(rsc)` or `(ssr)` module: the generated place of its own map and the DAP frame's source place. */
    hitAt(sourceLine: number): {
      generated: { line: number; column: number }
      source: { line: number; column: number }
    }
  }
  /** The built line of a source line in the first flavour. */
  builtLineOf(sourceLine: number): number
  /**
   * The pause a hit at a source line makes: the generated place of the eval module and the DAP frame's built place. The browser layer's place is inside a line, past a segment start, in the browser module's longer wrapper.
   */
  hitAt(
    sourceLine: number,
    layer?: EvalLayer,
  ): {
    generated: { line: number; column: number }
    source: { line: number; column: number }
  }
  /** Builds the eval module of that flavour's built text again, with another built text or wrapper size, as a recompile does. */
  evalModule(options?: {
    builtText?: string
    wrapperLines?: number
    layer?: EvalLayer
  }): string
}

/**
 * Gives the writer {@link configuredRuntimeHarness} calls after it created the repository: it writes the library package (`package.json`, the checked-out source's builds and maps), links it into the app folder, and builds the eval modules the server compile holds.
 * @param spec - What the fixture stages.
 * @returns A function from the repository directory and its real path to the files' facts.
 * @example libraryStop: libraryFixture({ flavours: ['modern', 'legacy'], inCompile: [] })
 */
export function libraryFixture(
  spec: LibraryFixtureSpec = {},
): (input: {
  directory: string
  realRoot: string
}) => Promise<LibraryHarnessFiles> {
  return async ({ directory, realRoot }) => {
    // A differing copy needs a browser module to differ from; without one the fixture would silently stage no ambiguity.
    if (spec.differingBrowserCopy && !spec.inBrowser?.length)
      throw new Error(
        'differingBrowserCopy needs at least one flavour in inBrowser',
      )
    const flavours = spec.flavours ?? ['modern']
    const inCompile = spec.inCompile ?? ['modern']
    const put = async (path: string, text: string): Promise<void> => {
      await mkdir(dirname(join(directory, path)), { recursive: true })
      await writeFile(join(directory, path), text)
    }
    await put(
      'packages/lib/package.json',
      JSON.stringify({ name: LIBRARY_NAME }),
    )
    const built = new Map<LibraryFlavour, BuiltFile>()
    for (const [index, flavour] of flavours.entries()) {
      const file = buildLibraryFile(spec.builtFrom ?? LIBRARY_SOURCE, flavour)
      const chosen =
        index === 0 && spec.rewriteBuilt ? spec.rewriteBuilt(file) : file
      built.set(flavour, chosen)
      await put(`packages/lib/build/${flavour}/core.js`, chosen.builtText)
      await put(`packages/lib/build/${flavour}/core.js.map`, chosen.mapText)
    }
    // The app reaches the library through a link inside the repository, as a workspace install lays it out.
    await mkdir(join(directory, LIBRARY_APP_FOLDER, 'node_modules'), {
      recursive: true,
    })
    await symlink(
      '../../../packages/lib',
      join(directory, LIBRARY_APP_FOLDER, 'node_modules', LIBRARY_NAME),
    )
    const runtimePathOf = (flavour: LibraryFlavour): string =>
      posix.relative(
        LIBRARY_APP_FOLDER,
        `packages/lib/build/${flavour}/core.js`,
      )
    const serverModules: Record<string, string> = {}
    for (const flavour of inCompile) {
      const file = built.get(flavour)!
      serverModules[`(pages-dir-node)/${runtimePathOf(flavour)}`] =
        libraryEvalModule({
          realRoot,
          builtPath: `packages/lib/build/${flavour}/core.js`,
          builtText: file.builtText,
          runtimePath: runtimePathOf(flavour),
        })
    }
    const browserModules: Record<string, string> = {}
    const browserAppModules: Record<string, string> = {}
    for (const [index, flavour] of (spec.inBrowser ?? []).entries()) {
      const file = built.get(flavour)!
      const moduleText = (wrapperLines?: number): string =>
        libraryEvalModule({
          realRoot,
          builtPath: `packages/lib/build/${flavour}/core.js`,
          builtText: file.builtText,
          runtimePath: runtimePathOf(flavour),
          layer: 'pages-dir-browser',
          wrapperLines,
        })
      browserModules[`(pages-dir-browser)/${runtimePathOf(flavour)}`] =
        moduleText()
      if (index === 0 && spec.differingBrowserCopy)
        browserAppModules[`(pages-dir-browser)/${runtimePathOf(flavour)}`] =
          moduleText(BROWSER_WRAPPER_LINE_COUNT + 1)
    }
    const first = inCompile[0] ?? flavours[0]!
    const firstFile = built.get(first)!
    const builtPath = `packages/lib/build/${first}/core.js`
    const runtimePath = runtimePathOf(first)
    const moduleJavascript = libraryEvalModule({
      realRoot,
      builtPath,
      builtText: firstFile.builtText,
      runtimePath,
    })
    // The browser module is the first browser-side flavour's, which may differ from the server's first.
    const firstBrowser = spec.inBrowser?.[0] ?? first
    const browserFile = built.get(firstBrowser)!
    const browserBuiltPath = `packages/lib/build/${firstBrowser}/core.js`
    const browserRuntimePath = runtimePathOf(firstBrowser)
    const builtLineIn = (file: BuiltFile, sourceLine: number): number => {
      const line = builtLineOfSourceLine(file.mapText, sourceLine)
      if (line === undefined)
        throw new Error(`No built line for source line ${sourceLine}`)
      return line
    }
    const builtLineOf = (sourceLine: number): number =>
      builtLineIn(firstFile, sourceLine)
    const files: LibraryHarnessFiles = {
      builtPath,
      runtimePath,
      builtText: firstFile.builtText,
      moduleJavascript,
      moduleMap: Buffer.from(
        /base64,([A-Za-z\d+/=]+)/.exec(moduleJavascript)![1]!,
        'base64',
      ).toString(),
      serverModules,
      browserModules,
      browserAppModules,
      browserModuleJavascript: libraryEvalModule({
        realRoot,
        builtPath: browserBuiltPath,
        builtText: browserFile.builtText,
        runtimePath: browserRuntimePath,
        layer: 'pages-dir-browser',
      }),
      browserAddress: `webpack-internal:///(pages-dir-browser)/${browserRuntimePath}`,
      realRoot,
      builtLineOf,
      hitAt(sourceLine, layer = 'pages-dir-node') {
        if (layer === 'pages-dir-browser') {
          const browserLine = builtLineIn(browserFile, sourceLine)
          return {
            generated: {
              line: browserLine - 1 + BROWSER_WRAPPER_LINE_COUNT,
              column: BROWSER_PAUSE_COLUMN,
            },
            source: { line: browserLine, column: 1 },
          }
        }
        const builtLine = builtLineOf(sourceLine)
        return {
          generated: { line: builtLine - 1 + WRAPPER_LINE_COUNT, column: 0 },
          source: { line: builtLine, column: 1 },
        }
      },
      evalModule(options = {}) {
        return libraryEvalModule({
          realRoot,
          builtPath,
          builtText: options.builtText ?? firstFile.builtText,
          runtimePath,
          wrapperLines: options.wrapperLines,
          layer: options.layer,
        })
      },
    }
    if (!spec.appRouter) return files
    return {
      ...files,
      ...(await writeAppRouterBuild({
        directory,
        realRoot,
        spec: spec.appRouter,
        flavours: spec.inBrowser ?? ['modern'],
        runtimePathOf,
      })),
    }
  }
}

/**
 * Writes the App Router side of a library fixture: the app folder, the App paths manifest, the entry route's client reference manifest and the two client chunks, and gives the facts the harness needs for the browser participant.
 * @param input - The repository, the app-router knobs, the `inBrowser` flavours and the runtime path of a flavour.
 * @returns The fields of {@link LibraryHarnessFiles} an App Router stop replaces: the browser module and its address, the hit in source terms and the file the frames name.
 * @example const extra = await writeAppRouterBuild({ directory, realRoot, spec: {}, flavours: ['modern'], runtimePathOf })
 */
async function writeAppRouterBuild(input: {
  directory: string
  realRoot: string
  spec: NonNullable<LibraryFixtureSpec['appRouter']>
  flavours: readonly LibraryFlavour[]
  runtimePathOf(flavour: LibraryFlavour): string
}): Promise<Partial<LibraryHarnessFiles>> {
  const { directory, realRoot, spec } = input
  const put = async (path: string, text: string): Promise<void> => {
    await mkdir(dirname(join(directory, path)), { recursive: true })
    await writeFile(join(directory, path), text)
  }
  const appFolder = join(LIBRARY_APP_FOLDER)
  const pageFolder = spec.routeGroup ? 'app/(shop)' : 'app'
  const pageKey = spec.routeGroup ? '/(shop)/page' : '/page'
  await put(
    join(appFolder, pageFolder, 'page.tsx'),
    'export default function Page() { return null }\n',
  )
  await put(
    join(appFolder, '.next/dev/server/app-paths-manifest.json'),
    JSON.stringify({ [pageKey]: `${pageFolder}/page.js` }),
  )
  const chunkPaths = {
    layout: 'static/chunks/app/layout.js',
    page: 'static/chunks/app/page.js',
  }
  await put(
    join(
      appFolder,
      `.next/dev/server/${pageFolder}/page_client-reference-manifest.js`,
    ),
    `globalThis.__RSC_MANIFEST=(globalThis.__RSC_MANIFEST||{});\nglobalThis.__RSC_MANIFEST[${JSON.stringify(pageKey)}]=${JSON.stringify(
      {
        clientModules: {
          'client.tsx#default': {
            id: 1,
            name: '*',
            chunks: [
              chunkPaths.layout,
              chunkPaths.page,
              'static/chunks/app/page.css',
            ],
          },
        },
      },
    )}`,
  )
  // The path Next writes: the build map's entry resolved against the app's package root.
  const mapSource = resolve(join(realRoot, appFolder), '../../src/core.ts')
  const moduleText = (flavour: LibraryFlavour, wrapperLines?: number): string =>
    libraryEvalModule({
      realRoot: '',
      builtPath: mapSource,
      builtText: LIBRARY_SOURCE,
      runtimePath: input.runtimePathOf(flavour),
      layer: 'app-pages-browser',
      wrapperLines,
      generatedLinesPerBuiltLine: APP_GENERATED_LINES_PER_SOURCE_LINE,
      mapOverride: {
        sources:
          typeof spec.mapSources === 'function'
            ? spec.mapSources(mapSource)
            : spec.mapSources,
        sourcesContent:
          spec.mapContent === undefined ? undefined : [spec.mapContent],
      },
    })
  const idOf = (flavour: LibraryFlavour): string =>
    `(app-pages-browser)/${input.runtimePathOf(flavour)}`
  const modulesOf = (
    flavours: readonly LibraryFlavour[],
    wrapperLines?: number,
  ): Record<string, string> =>
    Object.fromEntries(
      flavours.map((flavour) => [
        idOf(flavour),
        moduleText(flavour, wrapperLines),
      ]),
    )
  const chunks = {
    [chunkPaths.layout]: browserChunk('app/layout', {
      ...modulesOf(spec.chunks?.layout ?? input.flavours),
      ...(spec.extraNamingModule
        ? {
            '(app-pages-browser)/./src/other.ts': libraryEvalModule({
              realRoot: '',
              builtPath: mapSource,
              builtText: LIBRARY_SOURCE,
              runtimePath: './src/other.ts',
              layer: 'app-pages-browser',
            }),
          }
        : {}),
    }),
    [chunkPaths.page]: browserChunk(
      'app/page',
      modulesOf(
        spec.chunks?.page ?? input.flavours,
        spec.differingPageCopy ? BROWSER_WRAPPER_LINE_COUNT + 1 : undefined,
      ),
    ),
  }
  for (const [path, text] of Object.entries(chunks))
    await put(join(appFolder, '.next/dev', path), text)
  const first = input.flavours[0] ?? 'modern'
  const server = spec.server
    ? await writeAppRouterServerBuild({
        ...input,
        spec: spec.server,
        mapSource,
        put,
        appFolder,
        pageFolder,
      })
    : undefined
  return {
    ...(server
      ? {
          // The scripted server runs the `(rsc)` module and announces its address.
          moduleJavascript: server.rscJavascript,
          moduleMap: server.rscMap,
          appRouterServer: server.facts,
        }
      : {}),
    frameFile: LIBRARY_SOURCE_PATH,
    appRouter: { mapSource, chunks },
    browserModuleJavascript: moduleText(first),
    browserAddress: `webpack-internal:///${idOf(first)}`,
    hitAt: (sourceLine) => ({
      // The module's own map leads to the source line, so the hit is in source terms.
      generated: {
        line:
          (sourceLine - 1) * APP_GENERATED_LINES_PER_SOURCE_LINE +
          BROWSER_WRAPPER_LINE_COUNT,
        // The first segment of the line, which maps the line's first source column exactly.
        column: BROWSER_SEGMENT_COLUMNS[0],
      },
      source: { line: sourceLine, column: 1 },
    }),
  }
}

/**
 * Writes the entry route's server compile of an App Router fixture (`.next/dev/server/app/page.js`): the `(rsc)` and `(ssr)` modules of the library flavours, as E1 of Cycle 0081 measured them in Next 16.2.2.
 * @param input - The repository, the server knobs, the path the maps name, the writer and the app's folders.
 * @returns The first flavour's `(rsc)` text and map, and the facts a server stop's test reads.
 * @example const server = await writeAppRouterServerBuild({ directory, realRoot, spec: {}, flavours: ['modern'], runtimePathOf, mapSource, put, appFolder, pageFolder: 'app' })
 */
async function writeAppRouterServerBuild(input: {
  realRoot: string
  spec: NonNullable<NonNullable<LibraryFixtureSpec['appRouter']>['server']>
  flavours: readonly LibraryFlavour[]
  runtimePathOf(flavour: LibraryFlavour): string
  mapSource: string
  put(path: string, text: string): Promise<void>
  appFolder: string
  pageFolder: string
}) {
  const { spec } = input
  const rscFlavours = spec.rsc ?? input.flavours
  const ssrFlavours = spec.ssr ?? rscFlavours
  const moduleText = (
    layer: 'rsc' | 'ssr',
    flavour: LibraryFlavour,
    wrapperLines?: number,
  ): string =>
    libraryEvalModule({
      realRoot: '',
      builtPath: input.mapSource,
      builtText: LIBRARY_SOURCE,
      runtimePath: input.runtimePathOf(flavour),
      layer,
      wrapperLines,
      generatedLinesPerBuiltLine: APP_GENERATED_LINES_PER_SOURCE_LINE,
      mapOverride:
        layer === 'rsc'
          ? {
              sources:
                typeof spec.mapSources === 'function'
                  ? spec.mapSources(input.mapSource)
                  : spec.mapSources,
              sourcesContent:
                spec.mapContent === undefined ? undefined : [spec.mapContent],
            }
          : undefined,
    })
  // What Next writes for a `'use client'` file in the `(rsc)` layer: a proxy whose map names the proxy module.
  const stubText = (flavour: LibraryFlavour): string => {
    const map = {
      version: 3,
      sources: ['/next/dist/build/webpack/loaders/__nextjs-internal-proxy.mjs'],
      sourcesContent: [''],
      names: [],
      mappings: 'AAAA',
    }
    return `(0,x.registerClientReference)(function(){throw new Error("client")});\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,${Buffer.from(JSON.stringify(map)).toString('base64')}\n//# sourceURL=webpack-internal:///(rsc)/${input.runtimePathOf(flavour)}\n`
  }
  const modules: Record<string, string> = {}
  for (const flavour of rscFlavours) {
    const id = `(rsc)/${input.runtimePathOf(flavour)}`
    modules[id] = spec.clientStub
      ? stubText(flavour)
      : moduleText('rsc', flavour)
    if (spec.differingRscCopy)
      modules[`(rsc)/dup/${input.runtimePathOf(flavour)}`] = moduleText(
        'rsc',
        flavour,
        WRAPPER_LINE_COUNT + 1,
      )
  }
  for (const flavour of ssrFlavours)
    modules[`(ssr)/${input.runtimePathOf(flavour)}`] = moduleText(
      'ssr',
      flavour,
    )
  if (spec.extraNamingRscModule)
    modules['(rsc)/./src/other.ts'] = libraryEvalModule({
      realRoot: '',
      builtPath: input.mapSource,
      builtText: LIBRARY_SOURCE,
      runtimePath: './src/other.ts',
      layer: 'rsc',
    })
  const chunkPath = `server/${input.pageFolder}/page.js`
  await input.put(
    join(input.appFolder, '.next/dev', chunkPath),
    serverChunk(modules),
  )
  const first = rscFlavours[0] ?? 'modern'
  const rscJavascript = moduleText('rsc', first)
  const ssrJavascript = moduleText('ssr', ssrFlavours[0] ?? first)
  return {
    rscJavascript,
    rscMap: Buffer.from(
      /base64,([A-Za-z\d+/=]+)/.exec(rscJavascript)![1]!,
      'base64',
    ).toString(),
    facts: {
      rscJavascript,
      ssrJavascript,
      rscAddress: `webpack-internal:///(rsc)/${input.runtimePathOf(first)}`,
      ssrAddress: `webpack-internal:///(ssr)/${input.runtimePathOf(ssrFlavours[0] ?? first)}`,
      chunkPath,
      hitAt: (sourceLine: number) => ({
        generated: {
          line:
            (sourceLine - 1) * APP_GENERATED_LINES_PER_SOURCE_LINE +
            WRAPPER_LINE_COUNT,
          column: 0,
        },
        source: { line: sourceLine, column: 1 },
      }),
    },
  }
}
