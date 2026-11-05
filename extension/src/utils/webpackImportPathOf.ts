import { sourceImportBindings } from './sourceImportBindings'

/** A webpack development import of a compiled module: the variable it binds and the request named in its path comment. */
const HARMONY_IMPORT =
  /\/\* harmony import \*\/ var ([\w$]+__WEBPACK_IMPORTED_MODULE_\d+__) = __webpack_require__\(\/\*! (.+?) \*\/ /g
/** The first name of an inspection path (`useSelector` of `useSelector.name`). */
const FIRST_NAME = /^[A-Za-z_$][\w$]*/
/** A property name that can follow a dot. */
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/

/**
 * Rewrites a declared inspection path whose first name is an ES import of the stopped module into the expression webpack compiled that import to.
 *
 * Why: webpack (Next's development server and its browser bundles) renames every import binding to a member of the imported module's object (`useSelector` becomes `react_redux__WEBPACK_IMPORTED_MODULE_4__.useSelector`), so evaluating the source name at a pause throws `ReferenceError` although the learner's code reads that binding there. Called by {@link ConfiguredBrowserRun}'s inspection, which uses the rewrite only after the source name proved not to be in scope at the pause (a local of the same name always wins).
 * @param path - The declared inspection path.
 * @param source - The sealed original source of the stopped module; its imports are read by {@link sourceImportBindings}.
 * @param compiled - The compiled module text that ran, with webpack's development path comments.
 * @returns
 * - `{ name, compiledPath }` with the first name and the compiled expression (the rest of the path kept) when the first name is a default, named or namespace import whose request the compiled text imports
 * - `undefined` for any other path: a local name, a type-only import, a request this compiled text does not import
 * @example
 * webpackImportPathOf('useSelector.name', "import { useSelector } from 'react-redux'", compiledPage)
 * // => { name: 'useSelector', compiledPath: 'react_redux__WEBPACK_IMPORTED_MODULE_4__.useSelector.name' }
 * webpackImportPathOf('postgres', "import postgres from 'postgres'", compiledDb)
 * // => { name: 'postgres', compiledPath: 'postgres__WEBPACK_IMPORTED_MODULE_0__["default"]' }
 */
export function webpackImportPathOf(
  path: string,
  source: string,
  compiled: string,
): { name: string; compiledPath: string } | undefined {
  const name = FIRST_NAME.exec(path)?.[0]
  if (name === undefined) return undefined
  const imports = sourceImportBindings(source)
  const imported = imports.names.get(name)
  if (imported === undefined) return undefined
  const specifier = imports.declarations[imported.declaration]?.specifier
  const moduleObject =
    specifier === undefined ? undefined : compiledImportOf(compiled, specifier)
  if (moduleObject === undefined) return undefined
  return {
    name,
    compiledPath: `${compiledBindingOf(imported.exported, moduleObject, compiled)}${path.slice(name.length)}`,
  }
}

/**
 * Finds the variable webpack bound a request's module object to in a compiled module; called by {@link webpackImportPathOf}.
 * @param compiled - The compiled module text.
 * @param request - The import request as the source wrote it (`react-redux`, `./schema`).
 * @returns The variable (`react_redux__WEBPACK_IMPORTED_MODULE_4__`), or `undefined` when the text imports no such request.
 * @example compiledImportOf(compiledPage, 'react-redux') // => 'react_redux__WEBPACK_IMPORTED_MODULE_4__'
 */
function compiledImportOf(
  compiled: string,
  request: string,
): string | undefined {
  for (const harmonyImport of compiled.matchAll(HARMONY_IMPORT))
    if (harmonyImport[2] === request) return harmonyImport[1]
  return undefined
}

/**
 * Writes the expression that reads one import binding from the compiled module object; called by {@link webpackImportPathOf}.
 * @param exported - What the binding reads, as {@link sourceImportBindings} names it: an export name, `default`, or `*` for the namespace.
 * @param moduleObject - The compiled module object's variable.
 * @param compiled - The compiled module text, which says how webpack reads a default export.
 * @returns
 * - the variable itself for the namespace
 * - `variable_default()` when webpack bound a default getter (a CommonJS module), else `variable["default"]`, for the default export
 * - `variable.export` (`variable["export"]` for a name a dot cannot take) for a named export
 * @example compiledBindingOf('default', 'react__WEBPACK_IMPORTED_MODULE_3__', compiledPage) // => 'react__WEBPACK_IMPORTED_MODULE_3___default()'
 */
function compiledBindingOf(
  exported: string,
  moduleObject: string,
  compiled: string,
): string {
  if (exported === '*') return moduleObject
  // webpack reads a CommonJS module's default through the getter it binds as `<variable>_default`.
  if (exported === 'default')
    return compiled.includes(`var ${moduleObject}_default = `)
      ? `${moduleObject}_default()`
      : `${moduleObject}["default"]`
  return IDENTIFIER.test(exported)
    ? `${moduleObject}.${exported}`
    : `${moduleObject}[${JSON.stringify(exported)}]`
}
