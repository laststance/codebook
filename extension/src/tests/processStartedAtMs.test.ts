import assert from 'node:assert/strict'
import { test } from 'node:test'

import { processStartedAtMs } from '../utils/processStartedAtMs'

// Value: protects=the judgment of a recording's writer by the time its process began, on each system; fails_when=a start of one of the three systems is read as another time (Linux ticks taken for seconds or for milliseconds, the UTC text of ps or PowerShell read in local time), so a live writer is taken for a later process that got its id, or the other way round; why_new=Cycle 0046 /ship review R10 (a): a process start was compared only as text before; seam=the boot time handed to the reading
test('a process start of Windows, macOS and Linux is read as the time of the wall clock at which the process began', () => {
  // Act
  const startedAt = {
    windows: processStartedAtMs('win:2026-10-05T09:12:33.1234567Z'),
    macOS: processStartedAtMs('ps:Mon Oct  5 09:12:33 2026'),
    linuxInAPidNamespace: processStartedAtMs(
      'linux@4026531836:16362446',
      1_790_000_000_000,
    ),
    linuxWithoutItsNamespace: processStartedAtMs(
      'linux:16362446',
      1_790_000_000_000,
    ),
  }

  // Assert
  assert.deepEqual(startedAt, {
    windows: 1_791_191_553_123,
    macOS: 1_791_191_553_000,
    linuxInAPidNamespace: 1_790_163_624_460,
    linuxWithoutItsNamespace: 1_790_163_624_460,
  })
})

// Value: protects=a writer whose start cannot be read as a time, which then stays judged by its process id alone; fails_when=a text that names no time is read as a time (NaN or the epoch), so a live writer counts as a later process; why_new=Cycle 0046 /ship review R10 (a); seam=none
test('a process start that names no time is read as none', () => {
  // Act
  const startedAt = {
    withoutForm: processStartedAtMs('16362446'),
    ofAnotherSystem: processStartedAtMs('aix:16362446'),
    linuxWithoutTicks: processStartedAtMs('linux@4026531836:soon', 0),
    psWithoutATime: processStartedAtMs('ps:no such process'),
  }

  // Assert
  assert.deepEqual(startedAt, {
    withoutForm: undefined,
    ofAnotherSystem: undefined,
    linuxWithoutTicks: undefined,
    psWithoutATime: undefined,
  })
})
