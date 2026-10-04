import assert from 'node:assert/strict'
import { test } from 'node:test'

import { plannedStopLine } from '../utils/plannedStopLine'

/** Builds one journal entry of a live run; only its type and detail are read. @example journalEntry(1, 'breakpoint.registered', { participant: 'server', status: 'bound' }) */
function journalEntry(sequence: number, type: string, detail: unknown) {
  return { sequence, elapsedMs: sequence, wallTime: '', type, detail }
}

// Value: protects=the Study pane's source highlight before the first pause standing on the line a server stop will pause on, when the adapter first acknowledged the stop on a later line and the second request bound it on the requested line; fails_when=the first registration's later line is still read as the planned line, so the highlight stands one line too far until the pause; why_new=Cycle 0045 local review runtime-2 #2 (the journal holds two registrations for a stop requested a second time, and the second names no moved line); seam=none
test('the planned line of a server stop that was requested a second time and bound on its requested line is that line, not the line of the first acknowledgement', () => {
  // Arrange: a stop declared on line 22, column 40; the adapter acknowledged the first request on line 23, the run requested it again at 22:3, and the adapter acknowledged that request where it was made.
  const firstRegistration = journalEntry(1, 'breakpoint.registered', {
      participant: 'server',
      status: 'bound',
      movedTo: { line: 23, column: 1 },
    }),
    secondRequest = journalEntry(2, 'breakpoint.rearmed-on-requested-line', {
      participant: 'server',
      declared: { line: 22, column: 40 },
      armed: { line: 22, column: 3 },
      firstRequest: { line: 22, column: 40 },
      firstBinding: { line: 23, column: 1 },
    }),
    secondRegistration = journalEntry(3, 'breakpoint.registered', {
      participant: 'server',
      status: 'bound',
    })

  // Act
  const planned = {
    afterFirstAcknowledgement: plannedStopLine([firstRegistration]),
    afterSecondRequest: plannedStopLine([firstRegistration, secondRequest]),
    afterSecondAcknowledgement: plannedStopLine([
      firstRegistration,
      secondRequest,
      secondRegistration,
    ]),
  }

  // Assert
  assert.deepEqual(planned, {
    afterFirstAcknowledgement: 23,
    // The first acknowledgement answered the breakpoint the second request replaced.
    afterSecondRequest: 22,
    afterSecondAcknowledgement: 22,
  })
})

// Value: protects=the planned line of a stop that was armed after its declared line and then requested a second time: the line of that second request, once the adapter acknowledged it there; fails_when=the planned line falls back to nothing or to the first acknowledgement's later line; why_new=Cycle 0045 local review runtime-2 #2 (the second request has its own journal entry, which names the line); seam=none
test('the planned line of a stop armed after its declared line and requested a second time is the line of the second request', () => {
  // Arrange: a stop declared on the unmapped line 1 and requested on line 2; the adapter acknowledged it on line 4, and the second request on line 2 was acknowledged there.
  const journal = [
    journalEntry(1, 'breakpoint.armed-after-declared-line', {
      participant: 'server',
      declared: { line: 1, column: 1 },
      armed: { line: 2, column: 9 },
    }),
    journalEntry(2, 'breakpoint.registered', {
      participant: 'server',
      status: 'bound',
      movedTo: { line: 4, column: 1 },
    }),
    journalEntry(3, 'breakpoint.rearmed-on-requested-line', {
      participant: 'server',
      declared: { line: 1, column: 1 },
      armed: { line: 2, column: 1 },
      firstRequest: { line: 2, column: 9 },
      firstBinding: { line: 4, column: 1 },
    }),
    journalEntry(4, 'breakpoint.registered', {
      participant: 'server',
      status: 'bound',
    }),
  ]

  // Act
  const planned = plannedStopLine(journal)

  // Assert
  assert.equal(planned, 2)
})
