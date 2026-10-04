import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

import { runFlowKeepingCases } from '../utils/runFlowKeepingCases.mjs'

// Read as text and never imported: loading the script starts its server and its browser.
const scriptUrl = new URL('../study-bootstrap-qa.mjs', import.meta.url)

test('the pane DOM check loads its flow without eval', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act: the two ways a script turns text into code on its own.
  const textRunAsCode = script
    .split('\n')
    .flatMap((line, index) =>
      /\beval\b|\bnew Function\b/.test(line)
        ? [`${index + 1}: ${line.trim()}`]
        : [],
    )
  const flowCommands = script.match(/command\(\['run-code', .*\], 'flow'\)/g)

  // Assert: the flow is a file in the output folder that the browser CLI reads itself.
  assert.deepEqual(textRunAsCode, [])
  assert.deepEqual(flowCommands, [
    "command(['run-code', `--filename=${flowPath}`], 'flow')",
  ])
  assert.ok(
    script.includes('const flowPath = `${output}/flow.js`'),
    'the flow file is no longer written into the output folder',
  )
})

test('the pane DOM check derives every awaited revision from the first message', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act: a revision compared with a number of its own stops matching as soon as the first message's revision changes.
  const comparedWithNumbers = script
    .split('\n')
    .flatMap((line, index) =>
      /[Rr]evision\s*[!=]==?\s*\d/.test(line)
        ? [`${index + 1}: ${line.trim()}`]
        : [],
    )
  const messageRevisionsStatedAsNumbers = script.match(/\brevision: \d+/g)

  // Assert: only the first message states its revision; every later one and every comparison is revisionAt(n).
  assert.deepEqual(comparedWithNumbers, [])
  assert.deepEqual(messageRevisionsStatedAsNumbers, ['revision: 1'])
  assert.ok(
    script.includes(
      'const revisionAt = (step) => options.message.revision + step',
    ),
    'revisionAt no longer starts from the first message',
  )
})

// Value: protects=the Reader DOM report after one step of the flow throws (a control that is not offered, a wait past its limit); fails_when=the flow's one browser call ends without a result, so result.json names no case and a single missing control reads like a failure of the harness; why_new=Cycle 0045 local review other-1 #8; seam=none
test('a step of the pane DOM flow that throws ends as one failed case after the cases collected before it', async () => {
  // Arrange: a flow that passes two cases, notes a page error and then throws at a missing control.
  const flow = async (page, options, collected) => {
    collected.cases.push({
      name: `${options.kind} first paint`,
      actual: page.title,
      passed: true,
    })
    collected.errors.push('ReferenceError: render is not defined')
    collected.cases.push({ name: 'Saved studies', actual: 2, passed: true })
    throw new Error('locator.click: Timeout 5000ms exceeded.')
  }

  // Act
  const report = await runFlowKeepingCases(
    flow,
    { title: 'Loading study…' },
    { kind: 'context' },
  )

  // Assert
  assert.deepEqual(report, {
    cases: [
      { name: 'context first paint', actual: 'Loading study…', passed: true },
      { name: 'Saved studies', actual: 2, passed: true },
      {
        name: 'the flow stopped after the case "Saved studies"',
        actual: 'Error: locator.click: Timeout 5000ms exceeded.',
        passed: false,
      },
    ],
    errors: ['ReferenceError: render is not defined'],
  })
})

test('a pane DOM flow that runs to its end answers its cases as collected, and one that throws at once says so', async () => {
  // Arrange
  const completes = async (_page, _options, collected) => {
    collected.cases.push({ name: 'first paint', actual: 1, passed: true })
  }
  const throwsAtOnce = async () => {
    throw new Error('page.goto: net::ERR_CONNECTION_REFUSED')
  }

  // Act
  const completed = await runFlowKeepingCases(completes, {}, {})
  const stopped = await runFlowKeepingCases(throwsAtOnce, {}, {})

  // Assert
  assert.deepEqual(completed, {
    cases: [{ name: 'first paint', actual: 1, passed: true }],
    errors: [],
  })
  assert.deepEqual(stopped, {
    cases: [
      {
        name: 'the flow stopped before its first case',
        actual: 'Error: page.goto: net::ERR_CONNECTION_REFUSED',
        passed: false,
      },
    ],
    errors: [],
  })
})

test('the pane DOM check runs its flow inside the case keeper and gives that one call its own, longer limit', async () => {
  // Arrange
  const script = await readFile(scriptUrl, 'utf8')

  // Act
  const limits = Object.fromEntries(
    [...script.matchAll(/^const (COMMAND|FLOW)_TIMEOUT_MS = ([\d_]+)$/gm)].map(
      ([, name, value]) => [name, Number(value.replaceAll('_', ''))],
    ),
  )

  // Assert
  assert.deepEqual(limits, { COMMAND: 30_000, FLOW: 300_000 })
  assert.ok(
    script.includes(
      "timeout: label === 'flow' ? FLOW_TIMEOUT_MS : COMMAND_TIMEOUT_MS,",
    ),
    'the flow call has no limit of its own',
  )
  assert.ok(
    script.includes(
      '`async (page) => (${runFlowKeepingCases.toString()})(${check.toString()}, page, ${JSON.stringify(',
    ),
    'the flow is not run inside runFlowKeepingCases',
  )
  assert.ok(
    script.includes('async function check(page, options, collected) {') &&
      script.includes('  const { errors } = collected\n') &&
      script.includes('  const { cases } = collected,\n'),
    'the flow keeps lists of its own, which are lost when it throws',
  )
  // The keeper's text is run outside Node's module system: it may name nothing of its file.
  assert.doesNotMatch(runFlowKeepingCases.toString(), /\bimport\b|\brequire\b/)
})
