import type { BundleSource } from '../repositoryBundle'

/** The error {@link singleBundleOf} throws for differing copies; callers match on this class, not on the message. */
export class AmbiguousBundleError extends Error {
  constructor() {
    super('Ambiguous application source chunk')
    this.name = 'AmbiguousBundleError'
  }
}

/**
 * Reduces the copies of one stop's module that several chunks carry to the one module they are.
 *
 * Why it exists: a module that two chunks both carry with identical bytes is one module (the page and `_app` may share an import), while differing bytes cannot be told apart and must not be sealed. Called by {@link readPagesDevelopmentBundle} for the browser chunks and by {@link readPagesServerBundle} for the server chunks a compile requires.
 * @param bundles - The module as each chunk that carries it gave it.
 * @returns The first copy, or `undefined` when no chunk carries the module.
 * @throws {@link AmbiguousBundleError} (`Ambiguous application source chunk`) when two copies differ in their code or their map.
 * @example
 * singleBundleOf([bundle, bundle]) // => bundle
 * singleBundleOf([]) // => undefined
 */
export function singleBundleOf(
  bundles: readonly BundleSource[],
): BundleSource | undefined {
  const [first] = bundles
  if (
    first &&
    bundles.some(
      (bundle) =>
        bundle.javascript !== first.javascript ||
        bundle.sourceMap !== first.sourceMap,
    )
  )
    throw new AmbiguousBundleError()
  return first
}
