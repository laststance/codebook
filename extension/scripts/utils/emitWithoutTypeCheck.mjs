import { readFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

import ts from 'typescript'

/**
 * Produces the JavaScript and source maps `tsc -p tsconfig.json` writes, one source file at a time and without type checking, which takes a fraction of the compiler's time; called by `scripts/build-fast.mjs` for the CI test shards and for its comparison with a real build.
 *
 * The result equals the compiler's output because `isolatedModules` in tsconfig.json makes the type checker reject code whose emit depends on another file.
 * @param extensionDirectory - Directory that holds tsconfig.json and `src`.
 * @returns Map from a path below the output directory (for example `tests/service.test.js`) to the file content.
 * @throws When tsconfig.json cannot be read.
 * @example
 * const outputs = await emitWithoutTypeCheck('/repository/extension')
 * outputs.get('constants.js') // => '"use strict";\n…'
 */
export async function emitWithoutTypeCheck(extensionDirectory) {
  const configuration = ts.getParsedCommandLineOfConfigFile(
    join(extensionDirectory, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        )
      },
    },
  )
  const { rootDir, outDir } = configuration.options
  const outputs = new Map()
  for (const source of configuration.fileNames) {
    // A declaration file has no output.
    if (source.endsWith('.d.ts')) continue
    const output = relative(rootDir, source).replace(/\.ts$/, '.js')
    const emitted = ts.transpileModule(await readFile(source, 'utf8'), {
      compilerOptions: configuration.options,
      fileName: source,
    })
    outputs.set(output, emitted.outputText)
    if (!emitted.sourceMapText) continue
    // The compiler names a source relative to the map's own directory; a single-file emit names it by base name only.
    const map = JSON.parse(emitted.sourceMapText)
    map.sources = [relative(dirname(join(outDir, output)), source)]
    outputs.set(`${output}.map`, JSON.stringify(map))
  }
  return outputs
}
