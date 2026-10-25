import type {
  NodeTestExecutionPlan,
  NodeTestExecutionSummary,
} from '../../utils/planNodeTestExecution'

/** The plan facts of a test that runs at the opened root without a config, as most node-test runs of these tests do; a launch journals them and the manifest names them. */
export const ROOT_MODE_EXECUTION: NodeTestExecutionSummary = {
  vitestRoot: '.',
  vitestRootReason: 'no-config',
  rootClaim: 'not-applicable',
  vitestConfigFiles: [],
  skippedConfigFiles: [],
}

/**
 * The execution plan a fake environment's pre-history check returns for a root-mode run of the fixture repository `/repo`; tests whose runtime is a fake never read its paths.
 * @example service.environment.checkNodeTestFiles = async () => ROOT_MODE_EXECUTION_PLAN
 */
export const ROOT_MODE_EXECUTION_PLAN: NodeTestExecutionPlan = {
  vitestRoot: '/repo',
  nearestConfigDirectory: '/repo',
  vitest: {
    major: 5,
    version: '5.0.2',
    program: '/repo/node_modules/vitest/vitest.mjs',
    packageDirectory: '/repo/node_modules/vitest',
    directory: '/repo',
  },
  filter: 'src/theme.test.ts',
  summary: ROOT_MODE_EXECUTION,
}
