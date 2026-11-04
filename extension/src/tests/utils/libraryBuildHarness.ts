import { mkdir, symlink, writeFile } from 'node:fs/promises'
import { dirname, join, posix } from 'node:path'

import ts from 'typescript'

import { walkSourceMapSegments } from '../../utils/walkSourceMapSegments'

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

/** How many wrapper lines Next's module wrapper puts before the built code in the eval module (the generated line is the built line plus this). */
export const WRAPPER_LINE_COUNT = 2

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
  layer?: 'pages-dir-node' | 'pages-dir-browser'
}): string {
  const wrapper = input.wrapperLines ?? WRAPPER_LINE_COUNT
  const builtLines = input.builtText.split('\n')
  const code = [
    ...Array.from({ length: wrapper }, () => '/* wrapper */'),
    ...builtLines.map((_, index) => `work${index + 1}();`),
  ].join('\n')
  let previous = 0
  const segments = builtLines.map((_, index) => {
    const segment = `${vlq(0)}${vlq(0)}${vlq(index - previous)}${vlq(0)}`
    previous = index
    return segment
  })
  const map = {
    version: 3,
    file: '',
    sources: [join(input.realRoot, input.builtPath)],
    sourcesContent: [input.builtText],
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
  /** The built line of a source line in the first flavour. */
  builtLineOf(sourceLine: number): number
  /** The pause a hit at a source line makes: the generated place of the eval module and the DAP frame's built place. */
  hitAt(sourceLine: number): {
    generated: { line: number; column: number }
    source: { line: number; column: number }
  }
  /** Builds the eval module of that flavour's built text again, with another built text or wrapper size, as a recompile does. */
  evalModule(options?: {
    builtText?: string
    wrapperLines?: number
    layer?: 'pages-dir-node' | 'pages-dir-browser'
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
          moduleText(WRAPPER_LINE_COUNT + 1)
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
    const builtLineOf = (sourceLine: number): number => {
      const line = builtLineOfSourceLine(firstFile.mapText, sourceLine)
      if (line === undefined)
        throw new Error(`No built line for source line ${sourceLine}`)
      return line
    }
    return {
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
        builtPath,
        builtText: firstFile.builtText,
        runtimePath,
        layer: 'pages-dir-browser',
      }),
      browserAddress: `webpack-internal:///(pages-dir-browser)/${runtimePath}`,
      realRoot,
      builtLineOf,
      hitAt(sourceLine) {
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
  }
}
