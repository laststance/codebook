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
