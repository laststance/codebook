import assert from 'node:assert/strict'
import fs from 'node:fs'
import { test } from 'node:test'

import { processStartFormHere } from '../utils/processStartFormHere'

// Value: protects=a process keeps one form for as long as it runs, so it always knows its own locks and claims, and a storage lock costs no read of the namespace link; fails_when=the real link is read at every look, or a read that failed is tried again and the form changes while the process runs (Cycle 0046 row 65). This test is the first of its file, so the process has not asked before; why_new=the form names the namespace since row 65; seam=the link read of node:fs and the platform, so the test needs no /proc
test('the pid namespace of this process is read once, however often its form is asked for, also when the read failed', (context) => {
  // Arrange: the first read of the link fails, as in a sandbox that hides it; a later one would answer.
  let reads = 0
  context.mock.method(fs, 'readlinkSync', (): string => {
    reads += 1
    if (reads === 1) throw new Error('EACCES: permission denied, readlink')
    return 'pid:[4026531836]'
  })
  // Act
  const forms = [
    processStartFormHere({ platform: 'linux' }),
    processStartFormHere({ platform: 'linux' }),
    processStartFormHere({ platform: 'linux' }),
  ]
  // Assert
  assert.deepEqual(forms, ['linux', 'linux', 'linux'])
  assert.equal(reads, 1)
})

// Value: protects=two pid namespaces on one kernel (two WSL distributions, a container and its host) have two forms, so a process id of one is never probed in the other; fails_when=the Linux form names no namespace, or not the one the link names (Cycle 0046 row 65); why_new=the form names the namespace since row 65; seam=the injected platform and namespace link
test('the Linux form names the pid namespace the link points to, and two namespaces have two forms', () => {
  // Arrange
  const readPaths: string[] = []
  // Act
  const inOneDistribution = processStartFormHere({
      platform: 'linux',
      readLink: (path) => {
        readPaths.push(path)
        return 'pid:[4026531836]'
      },
    }),
    inAnotherDistribution = processStartFormHere({
      platform: 'linux',
      readLink: () => 'pid:[4026532214]',
    })
  // Assert
  assert.equal(inOneDistribution, 'linux@4026531836')
  assert.equal(inAnotherDistribution, 'linux@4026532214')
  assert.deepEqual(readPaths, ['/proc/self/ns/pid'])
})

// Value: protects=a Linux process that cannot read its pid namespace still has a form, the one without a namespace, and never a form made of an unexpected text; fails_when=an unreadable link throws or gives no form, or the link's text is put into the form unchecked (a colon in it would cut the form short); why_new=the form names the namespace since row 65; seam=the injected platform and namespace link
test('the Linux form has no namespace when the link cannot be read or points to something else', () => {
  // Act
  const forms = {
    linkCannotBeRead: processStartFormHere({
      platform: 'linux',
      readLink: () => {
        throw new Error('ENOENT: no such file or directory, readlink')
      },
    }),
    linkNamesSomethingElse: processStartFormHere({
      platform: 'linux',
      readLink: () => 'net:[4026531840]',
    }),
    linkIsEmpty: processStartFormHere({
      platform: 'linux',
      readLink: () => '',
    }),
  }
  // Assert
  assert.deepEqual(forms, {
    linkCannotBeRead: 'linux',
    linkNamesSomethingElse: 'linux',
    linkIsEmpty: 'linux',
  })
})

// Value: protects=macOS and Windows keep the forms their queries answer and read no link, and a system without a query has no form; fails_when=the namespace is asked for or added on a system that has none, or an unknown platform gets a form and its records are judged; why_new=the form has one source since row 65; seam=the injected platform and namespace link
test('macOS has the form ps and Windows the form win without a read of any link, and another platform has no form', () => {
  // Arrange
  const readPaths: string[] = []
  const readLink = (path: string): string => {
    readPaths.push(path)
    return 'pid:[4026531836]'
  }
  // Act
  const forms = {
    darwin: processStartFormHere({ platform: 'darwin', readLink }),
    win32: processStartFormHere({ platform: 'win32', readLink }),
    freebsd: processStartFormHere({ platform: 'freebsd', readLink }),
  }
  // Assert
  assert.deepEqual(forms, { darwin: 'ps', win32: 'win', freebsd: undefined })
  assert.deepEqual(readPaths, [])
})
