/** The stop file of the fixture: a normalized path, no application code. */
export const FIXTURE_STOP_PATH = '/repo/apps/api/src/handler.ts'

/** The TypeScript original (the stop file's text). */
export const FIXTURE_ORIGINAL = `type Input = { id: string }
export async function handle(input: Input) {
  const id = input.id
  return { id }
}
`

/** The JavaScript a tsx-like transpile emits for {@link FIXTURE_ORIGINAL}, without the trailing map comment. */
export const FIXTURE_JAVASCRIPT = `export async function handle(input) {
  const id = input.id;
  return { id };
}
`

/**
 * Builds a tsx-shaped V3 map (E1: one inline map, absolute `sources`, `sourcesContent` present) for {@link FIXTURE_ORIGINAL}.
 * Generated line 2 maps original line 3 (`const id`), so line 3 is a declarable stop.
 * @param overrides - Fields replacing the E1-shaped ones.
 * @returns The map as a JSON object.
 * @example fixtureMap({ sourceRoot: '/x' }).sourceRoot // '/x'
 */
export function fixtureMap(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 3,
    sources: [FIXTURE_STOP_PATH],
    sourcesContent: [FIXTURE_ORIGINAL],
    names: [],
    mappings: 'AACA;EACE;EACA;AACF',
    ...overrides,
  }
}

/**
 * Renders the executed script text: the JavaScript followed by an inline `data:` map comment.
 * @param map - The map object, or `undefined` for a script with no map comment.
 * @param javascript - The generated code.
 * @returns The script source as `Debugger.getScriptSource` returns it.
 * @example fixtureScript(fixtureMap()).includes('sourceMappingURL=data:application/json;base64,') // true
 */
export function fixtureScript(
  map: Record<string, unknown> | undefined,
  javascript: string = FIXTURE_JAVASCRIPT,
): string {
  if (!map) return javascript
  const encoded = Buffer.from(JSON.stringify(map)).toString('base64')
  return `${javascript}//# sourceMappingURL=data:application/json;base64,${encoded}\n`
}
