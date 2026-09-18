import assert from 'node:assert/strict';
import type { PairedRun } from '../run';
import type { Scenario } from '../constants';

type FinalState = Pick<ReturnType<PairedRun['view']>, 'status' | 'cleaned' | 'activeSessionIds' | 'finalOutcome' | 'failures'>;

/** Validates the post-teardown result for the external runner so a revoked candidate cannot leave a green case. @example assertFinalScenario('normal', finalState) */
export function assertFinalScenario(scenario: Scenario, state: FinalState): void {
  assert.equal(state.cleaned, true);
  assert.deepEqual(state.activeSessionIds, []);
  if (['normal', 'hold', 'duplicate', 'continue-race', 'decoy', 'capture-timeout'].includes(scenario)) {
    assert.equal(state.status, 'completed', state.failures.join('\n'));
    assert.deepEqual(state.failures, []);
    assert.equal(state.finalOutcome, scenario === 'capture-timeout' ? 'partial' : 'demonstrated');
  } else {
    assert.equal(state.status, ['cancel-launch', 'cancel-pause'].includes(scenario) ? 'cancelled' : 'failed');
    assert.equal(state.finalOutcome, 'not-demonstrated');
    if (scenario === 'late-request') assert.match(state.failures.join('\n'), /after the expected observation set closed/);
  }
}
