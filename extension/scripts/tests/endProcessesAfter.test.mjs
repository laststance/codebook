import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  endProcesses,
  endProcessesAfter,
  processRuns,
  readNotedPids,
  readProcess,
} from './utils/endProcessesAfter.mjs'

/** Starts a Node process that waits until it is killed, and answers it once it runs. */
async function startWaitingProcess() {
  const child = spawn(
    process.execPath,
    ['-e', 'process.stdout.write("ready"); setInterval(() => {}, 1000)'],
    { stdio: ['ignore', 'pipe', 'ignore'] },
  )
  await once(child.stdout, 'data')
  return child
}

// Value: protects=a test's clean-up from killing an id it cannot confirm as its own where `ps` is unavailable (a recycled id could be an unrelated process); fails_when=an unreadable ownership counts as owned, so the id is SIGKILLed; why_new=Cycle 0064 pt3 review (CodeRabbit major); seam=endProcesses with an injected process reader that answers 'unreadable' for a running child; no_claim=the Windows listing
test('a running process whose ownership cannot be read is not signalled and is reported as a survivor', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))
  const signalled = []

  // Act
  const survivors = await endProcesses([child.pid], {
    readProcessInfo: () => 'unreadable',
    kill: (pid) => signalled.push(pid),
    waitMs: 100,
  })

  // Assert
  assert.deepEqual(
    { survivors, signalled },
    { survivors: [child.pid], signalled: [] },
  )
})

test('a child the test holds a handle of is ended although the process reader cannot say whose it is', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))

  // Act
  const survivors = await endProcesses([child.pid], {
    held: [child.pid],
    readProcessInfo: () => 'unreadable',
    waitMs: 2_000,
  })
  if (child.exitCode === null && child.signalCode === null)
    await once(child, 'exit')

  // Assert
  assert.deepEqual(survivors, [])
  assert.equal(processRuns(child.pid), false)
})

// Value: protects=the test runner from being killed by its own clean-up; fails_when=the orphan rule owns this process or its parent (a runner that is process 1 of a container, or started just before the test); why_new=Cycle 0064 pt3 review (CodeRabbit minor); seam=endProcesses with a reader that shows every id as a young orphan; no_claim=ancestors above the parent
test('this process and its parent are never signalled, even when they look like a young orphan', async () => {
  // Arrange
  const signalled = []

  // Act
  const survivors = await endProcesses([process.pid, process.ppid], {
    readProcessInfo: () => ({ state: 'S', parentPid: 1, ageSeconds: 0 }),
    kill: (pid) => signalled.push(pid),
    waitMs: 100,
  })

  // Assert
  assert.deepEqual({ survivors, signalled }, { survivors: [], signalled: [] })
})

// Value: protects=the leak check from missing a grandchild that a Linux subreaper (a `systemd --user` manager, a container init that is not process 1) adopted when its parent was killed; fails_when=an orphan counts as the test's only when its parent is process 0 or 1, so the adopted grandchild is foreign, never ended and never reported; why_new=Cycle 0064 task 124; seam=endProcesses with a real child and an injected reader that gives it this process's parent as its parent; no_claim=a real subreaper
test(
  'an orphan adopted by a farther ancestor of the test is ended when it is young and left alone when it is old',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const young = await startWaitingProcess()
    const old = await startWaitingProcess()
    context.after(() => young.kill('SIGKILL'))
    context.after(() => old.kill('SIGKILL'))
    // The ancestors are {ppid, 424242}: the adopter 424242 is farther than the runner.
    const readAdoptedBy = (ageSeconds) => (pid) => {
      if (pid === process.ppid)
        return { state: 'S', parentPid: 424242, ageSeconds: 86_400 }
      if (pid === 424242)
        return { state: 'S', parentPid: 1, ageSeconds: 86_400 }
      return { state: 'S', parentPid: 424242, ageSeconds }
    }
    const signalledOfYoung = []
    const signalledOfOld = []

    // Act
    await endProcesses([young.pid], {
      readProcessInfo: readAdoptedBy(0),
      kill: (pid) => signalledOfYoung.push(pid),
      waitMs: 100,
    })
    await endProcesses([old.pid], {
      readProcessInfo: readAdoptedBy(86_400),
      kill: (pid) => signalledOfOld.push(pid),
      waitMs: 100,
    })

    // Assert
    assert.deepEqual(signalledOfYoung, [young.pid])
    assert.deepEqual(signalledOfOld, [])
  },
)

// Value: protects=a sibling test-file process of the runner (`node --test` starts them all the time, and is no subreaper) from being killed by a clean-up that holds its recycled id; fails_when=a parent among the ancestors counts as the adopter, so a young child of the direct parent is taken for the test's; why_new=Cycle 0064 task 132; seam=endProcesses with a real child and an injected reader that gives it this process's direct parent as its parent; no_claim=a real runner
test(
  'a young process whose parent is the runner of the test is a sibling and is not signalled',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const sibling = await startWaitingProcess()
    context.after(() => sibling.kill('SIGKILL'))
    const signalled = []

    // Act
    await endProcesses([sibling.pid], {
      readProcessInfo: (pid) =>
        pid === process.ppid
          ? { state: 'S', parentPid: 424242, ageSeconds: 86_400 }
          : { state: 'S', parentPid: process.ppid, ageSeconds: 0 },
      kill: (pid) => signalled.push(pid),
      waitMs: 100,
    })

    // Assert
    assert.deepEqual(signalled, [])
  },
)

// Value: protects=a process that took over a noted id between the tree end and the final kill from being killed on the strength of the first classification; fails_when=the ownership classified before the tree end is reused for the final kill; why_new=Cycle 0064 task 133; seam=endProcessesAfter with a reader option whose answer for the id changes when the tree end runs; no_claim=a real id recycling
test(
  'an id that reads as a foreign old process after the tree end is not signalled by the final kill',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const process_ = await startWaitingProcess()
    context.after(() => process_.kill('SIGKILL'))
    let treeEnded = false
    const hooks = []
    endProcessesAfter(
      { after: (hook) => hooks.push(hook) },
      () => [process_.pid],
      () => {
        treeEnded = true
      },
      {
        readProcessInfo: (pid) =>
          pid === process.ppid
            ? { state: 'S', parentPid: 1, ageSeconds: 86_400 }
            : treeEnded
              ? { state: 'S', parentPid: 424242, ageSeconds: 86_400 }
              : { state: 'S', parentPid: 1, ageSeconds: 0 },
      },
    )

    // Act
    await hooks[0]()

    // Assert
    assert.equal(treeEnded, true)
    assert.equal(processRuns(process_.pid), true)
  },
)

// Value: protects=the orphan age rule (an orphan older than the test is somebody else's with the same id by chance); fails_when=the age comparison is inverted or dropped, so an old orphan of process 1 is signalled or a young one is not; why_new=Cycle 0064 task 125; seam=endProcesses with a real child and an injected reader that answers a parent of process 1 and a given age; no_claim=the two-second slack of the comparison
test(
  'an orphan of process 1 is signalled when it started after the test and left alone when it is older',
  { skip: process.platform === 'win32' },
  async (context) => {
    // Arrange
    const ages = [86_400, 0]
    const results = []

    for (const ageSeconds of ages) {
      const child = await startWaitingProcess()
      context.after(() => child.kill('SIGKILL'))
      const signalled = []

      // Act
      await endProcesses([child.pid], {
        readProcessInfo: () => ({ state: 'S', parentPid: 1, ageSeconds }),
        kill: (pid) => signalled.push(pid),
        waitMs: 100,
      })
      results.push({ ageSeconds, signalled: signalled.length > 0 })
    }

    // Assert
    assert.deepEqual(results, [
      { ageSeconds: 86_400, signalled: false },
      { ageSeconds: 0, signalled: true },
    ])
  },
)

// Value: protects=the speed of every end from one `ps` per ancestor hop for every id it classifies; fails_when=each id walks the ancestor chain again; why_new=Cycle 0064 task 126; seam=endProcesses with three real children and a counting reader; no_claim=the number of reads of the ids themselves
test('the ancestor chain of the test is read once however many ids an end classifies', async (context) => {
  // Arrange
  const children = [
    await startWaitingProcess(),
    await startWaitingProcess(),
    await startWaitingProcess(),
  ]
  for (const child of children) context.after(() => child.kill('SIGKILL'))
  let readsOfParent = 0
  const countingReader = (pid) => {
    if (pid === process.ppid) readsOfParent += 1
    return readProcess(pid)
  }

  // Act
  await endProcesses(
    children.map((child) => child.pid),
    { readProcessInfo: countingReader, kill: () => {}, waitMs: 50 },
  )

  // Assert
  assert.equal(readsOfParent, 1)
})

test('a pid file that cannot be read fails the clean-up, and the held child is ended', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))
  const hooks = []
  const fakeContext = { after: (hook) => hooks.push(hook) }
  endProcessesAfter(
    fakeContext,
    () =>
      Promise.reject(
        Object.assign(new Error('EACCES: permission denied'), {
          code: 'EACCES',
        }),
      ),
    undefined,
    { held: () => [child.pid] },
  )

  // Act
  const error = await hooks[0]().then(
    () => undefined,
    (failure) => failure,
  )
  if (child.exitCode === null && child.signalCode === null)
    await once(child, 'exit')

  // Assert
  assert.match(String(error), /EACCES/)
  assert.equal(processRuns(child.pid), false)
})

// Value: protects=the processes of a test from outliving it when its tree end throws; fails_when=a throwing killTree skips the final kill, so the held child runs on; why_new=Cycle 0064 pt3 local CodeRabbit CLI r8; seam=endProcessesAfter with a stand-in context and a killTree that throws before it ends anything; no_claim=Windows (the held child is ended there too, by its handle)
test('a tree end that throws still lets the final kill end the test process, and the failure is reported', async (context) => {
  // Arrange
  const child = await startWaitingProcess()
  context.after(() => child.kill('SIGKILL'))
  const hooks = []
  const fakeContext = { after: (hook) => hooks.push(hook) }
  endProcessesAfter(
    fakeContext,
    () => [child.pid],
    () => {
      throw new Error('tree end refused')
    },
    { held: () => [child.pid] },
  )

  // Act
  const error = await hooks[0]().then(
    () => undefined,
    (failure) => failure,
  )

  // Assert: the final kill waited until the child was gone (an unreaped child counts as gone).
  assert.match(String(error), /tree end refused/)
  assert.equal(processRuns(child.pid), false)
})

// Value: protects=the clean-up from taking an unreadable pid file for "no pids"; fails_when=every read failure answers no ids; why_new=Cycle 0064 pt3 review (CodeRabbit major); seam=readNotedPids with a real file made unreadable; no_claim=Windows, where chmod does not deny a read
test(
  'a pid file the test cannot read fails the read instead of answering no ids, and a missing file answers none',
  { skip: process.platform === 'win32' || process.getuid?.() === 0 },
  async (context) => {
    // Arrange
    const folder = await mkdtemp(join(tmpdir(), 'pid-files-'))
    context.after(() => rm(folder, { recursive: true, force: true }))
    const unreadable = join(folder, 'unreadable.pid')
    await writeFile(unreadable, '4242\n')
    await chmod(unreadable, 0o000)

    // Act
    const missing = await readNotedPids(join(folder, 'missing.pid'))
    const failure = await readNotedPids(unreadable).then(
      () => undefined,
      (error) => error,
    )

    // Assert
    assert.deepEqual(missing, [])
    assert.match(String(failure), /EACCES/)
  },
)

// Value: protects=a leaked process from counting as ended when `ps` fails to run (EAGAIN, EMFILE, ENOMEM); fails_when=every `ps` failure but ENOENT reads as "no such process"; why_new=Cycle 0064 pt3 review (CodeRabbit minor); seam=readProcess with an injected exec that throws; no_claim=a real `ps` failure
test('a ps failure other than exit status 1 is unreadable, so a live process is not taken for gone', () => {
  // Arrange
  const failWith = (properties) => () => {
    throw Object.assign(new Error('ps failed'), properties)
  }

  // Act
  const noProcess = readProcess(4242, failWith({ status: 1 }))
  const noPs = readProcess(4242, failWith({ code: 'ENOENT' }))
  const outOfProcesses = readProcess(4242, failWith({ code: 'EAGAIN' }))
  const crashed = readProcess(4242, failWith({ status: 2 }))

  // Assert
  assert.equal(noProcess, undefined)
  assert.equal(noPs, 'unreadable')
  assert.equal(outOfProcesses, 'unreadable')
  assert.equal(crashed, 'unreadable')
})
