import assert from 'node:assert/strict'
import { test } from 'node:test'

import { isProcessGone } from '../utils/isProcessGone'

// Value: protects=a storage lock or a recording of a running writer that this user may not signal is never treated as left behind; fails_when=every failed probe counts as "gone", so the lock of such a writer is taken over and both write (Cycle 0044 row ST-12); why_new=the lock tests used real exited and running process ids, which never answer EPERM; seam=the process probe
test('a writer process this user may not signal still counts as running, and only a process that does not exist is gone', (context) => {
  // Arrange: the probe of process 4242 is refused, and the probe of process 4243 finds no process.
  const probeAnswers = new Map([
    [4242, 'EPERM'],
    [4243, 'ESRCH'],
  ])
  context.mock.method(process, 'kill', (pid: number): true => {
    const code = probeAnswers.get(pid)
    throw Object.assign(new Error(`kill ${code}`), { code })
  })
  // Act
  const isUnsignalableWriterGone = isProcessGone(4242),
    isAbsentWriterGone = isProcessGone(4243)
  // Assert
  assert.equal(isUnsignalableWriterGone, false)
  assert.equal(isAbsentWriterGone, true)
})

// Value: protects=a file with an owner record that names a process id no system can have (a repository can supply a Wiki update marker with "pid": 4294967295) does not count as a running writer's; fails_when=such an id reaches the system's probe, which refuses it with an argument error that is no "no such process", so the probe answers "may still run" and the marker refuses a start for about 21 minutes (Cycle 0046 row 180); why_new=the probe was asked ids of real and mocked processes only; seam=none (the system's own probe)
test('a process id above the largest a system can have names no process, and the largest one is still asked of the system', () => {
  // Act: the real probe, with no process of these ids on any system (the largest id of Linux is 4194304, of macOS 99998, and a Windows id is a multiple of four).
  const gone = {
    id4294967295: isProcessGone(4_294_967_295),
    id2147483648: isProcessGone(2_147_483_648),
    id2147483647: isProcessGone(2_147_483_647),
    thisProcess: isProcessGone(process.pid),
  }
  // Assert
  assert.deepEqual(gone, {
    id4294967295: true,
    id2147483648: true,
    id2147483647: true,
    thisProcess: false,
  })
})

// Value: protects=the probe never hands the system a number that is no process id: above the largest, the system refuses it; at zero and below, it would be asked about a process group or about every process, and a fraction is refused; fails_when=any of them reaches `process.kill`, or an id a process can have (1 to 2147483647) is answered without asking the system, so the lock of a running writer whose id is 1 or 2147483647 is taken over (Cycle 0046 row 180); why_new=the probe had no bound; seam=the process probe, which records what it is asked and refuses the two ids it is asked
test('only a whole number from 1 to 2147483647 is asked of the system as a process id, and every other number names no process', (context) => {
  // Arrange: the system refuses a signal to process 1 (it runs and is another user's) and finds no process 2147483647.
  const asked: number[] = []
  context.mock.method(process, 'kill', (pid: number): true => {
    asked.push(pid)
    const code = pid === 1 ? 'EPERM' : 'ESRCH'
    throw Object.assign(new Error(`kill ${code}`), { code })
  })
  // Act
  const gone = {
    one: isProcessGone(1),
    largest: isProcessGone(2_147_483_647),
    aboveTheLargest: isProcessGone(2_147_483_648),
    id4294967295: isProcessGone(4_294_967_295),
    largestSafeInteger: isProcessGone(Number.MAX_SAFE_INTEGER),
    zero: isProcessGone(0),
    minusOne: isProcessGone(-1),
    aFraction: isProcessGone(1.5),
    notANumber: isProcessGone(Number.NaN),
  }
  // Assert
  assert.deepEqual(gone, {
    one: false,
    largest: true,
    aboveTheLargest: true,
    id4294967295: true,
    largestSafeInteger: true,
    zero: true,
    minusOne: true,
    aFraction: true,
    notANumber: true,
  })
  assert.deepEqual(asked, [1, 2_147_483_647])
})
