import type {
  OperationsRepositoryConfiguration,
  RepositoryOperation,
} from '../repositoryConfigSchemas'

const NO_OPERATIONS: readonly RepositoryOperation[] = []

/**
 * Reads the ordered operations a version 3 configuration declares, an empty list when `operations` is omitted.
 *
 * A configuration may omit `operations` only when every stop is an entry-render stop (`afterOperation: 0`); the runtime, the service and the validators then see no operation to dispatch.
 * Called by the configured run, the service and the study validators wherever they index or count operations.
 *
 * @param configuration - A parsed version 3 configuration.
 * @returns The declared operations in order; a shared empty list when the field is omitted.
 * @example
 * ```ts
 * declaredOperationsOf({ ...configuration, operations: undefined }).length // 0
 * ```
 */
export function declaredOperationsOf(
  configuration: Pick<OperationsRepositoryConfiguration, 'operations'>,
): readonly RepositoryOperation[] {
  return configuration.operations ?? NO_OPERATIONS
}
