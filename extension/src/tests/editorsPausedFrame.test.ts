import assert from 'node:assert/strict'
import { test } from 'node:test'

import { editorsPausedFrame } from '../runtimeSupport/utils/editorsPausedFrame'

// Value: protects=the keyboard at a pause in Node's own code: the editor focuses no frame when every answered frame is deemphasized at a reason other than breakpoint, step and function breakpoint; fails_when=a deemphasized frame is taken for the one the editor focuses, so a frame the learner selects later gets the keyboard; why_new=Cycle 0046, the limit left by finding 603 (VS Code 1.140.0 workbench line 695 col 4742, getTopStackFrame); seam=none
test('a pause whose frames are all deemphasized has no frame the editor focuses', () => {
  // Arrange: js-debug's frames of a pause in Node's timers, skipped by skipFiles.
  const frames = [
    {
      id: 1,
      presentationHint: 'deemphasize',
      source: { path: '<node_internals>/timers', sourceReference: 3 },
    },
    {
      id: 2,
      presentationHint: 'deemphasize',
      source: { path: '<node_internals>/internal/timers', sourceReference: 4 },
    },
  ]

  // Act
  const paused = editorsPausedFrame(frames, 'pause')

  // Assert
  assert.equal(paused, undefined)
})

// Value: protects=the keyboard at a pause or an uncaught exception whose top frame is in skipped code and whose caller is the learner's: the editor focuses the first frame that is not deemphasized; fails_when=the top frame is taken for the focused one, so the editor's report of the caller's frame gets no keyboard; why_new=Cycle 0046, the limit left by finding 603; seam=none
test('an exception thrown in skipped code is focused at the first frame that is not deemphasized', () => {
  // Arrange: a deemphasized top frame, a label frame without a source, and the learner's frame.
  const frames = [
    {
      id: 1,
      presentationHint: 'deemphasize',
      source: { path: '<node_internals>/fs', sourceReference: 3 },
    },
    { id: 2, presentationHint: 'label' },
    { id: 3, presentationHint: 'normal', source: { path: '/app/actions.ts' } },
  ]

  // Act
  const paused = editorsPausedFrame(frames, 'exception')

  // Assert
  assert.equal(paused?.id, 3)
})

// Value: protects=the keyboard at a breakpoint or a step in a file of skipFiles: the editor focuses the top frame with a source at these reasons even when it is deemphasized; fails_when=the deemphasis rule is applied to every reason, so a breakpoint in a skipped file gets no hand-over and the keyboard falls on the window body; why_new=Cycle 0046, the limit left by finding 603 (bnr = breakpoint, step, function breakpoint); seam=none
test('a breakpoint, a step and a function breakpoint are focused at the first frame with a source, deemphasized or not', () => {
  // Arrange: a frame without a source, then a deemphasized frame with one.
  const frames = [
    { id: 1, presentationHint: 'label' },
    {
      id: 2,
      presentationHint: 'deemphasize',
      source: { path: '/app/node_modules/lib/index.js' },
    },
  ]

  // Act
  const paused = ['breakpoint', 'step', 'function breakpoint'].map(
    (reason) => editorsPausedFrame(frames, reason)?.id,
  )

  // Assert
  assert.deepEqual(paused, [2, 2, 2])
})

// Value: protects=the frame the editor's own rule focuses: a frame's own hint counts before its source's, `subtle` counts like `deemphasize`, and frames the learner loads beyond the first twenty are no candidates; fails_when=the reader picks another frame than the editor does, so its report of the stop's frame gets no keyboard or a frame the learner selects gets it; why_new=Cycle 0046, the limit left by finding 603 (T3 reads presentationHint ?? source.presentationHint; refreshTopOfCallstack loads 1 and then 19 frames); seam=none
test('the editor’s rule reads a frame’s own hint first, treats subtle as deemphasized and looks at the first twenty frames only', () => {
  // Arrange: a subtle frame, a frame whose own normal hint outweighs its deemphasized source, and a stack whose only candidate is the twenty-first frame.
  const ownHintFirst = [
    { id: 1, presentationHint: 'subtle', source: { path: '/app/a.ts' } },
    {
      id: 2,
      presentationHint: 'normal',
      source: { path: '/app/b.ts', presentationHint: 'deemphasize' },
    },
  ]
  const deepCandidate = [
    ...Array.from({ length: 20 }, (_, index) => ({
      id: index + 1,
      presentationHint: 'deemphasize',
      source: { path: `/app/skipped-${index}.js` },
    })),
    { id: 21, presentationHint: 'normal', source: { path: '/app/c.ts' } },
  ]

  // Act
  const paused = [
    editorsPausedFrame(ownHintFirst, 'pause')?.id,
    editorsPausedFrame(deepCandidate, 'pause')?.id,
  ]

  // Assert
  assert.deepEqual(paused, [2, undefined])
})

// Value: protects=the keyboard at a stop whose top frame the adapter has not answered yet while a later frame is: the editor's rule takes the first qualifying frame, so no frame below an unanswered one can be named before that one is known; fails_when=a hole is skipped and a later frame is named, so StopKeyboardHandOver hands the keyboard over at a frame the editor does not focus when the unanswered top frame is the learner's; why_new=OCR6-1; seam=none; no_claim=the order in which a real adapter answers the editor's two stackTrace requests
test('a frame below one the adapter has not answered yet is not taken for the frame the editor focuses', () => {
  // Arrange: the answer for frames 1 to 19 came first; the top frame's answer is still out.
  const frames = [
    undefined,
    { id: 2, presentationHint: 'normal', source: { path: '/app/actions.ts' } },
  ]

  // Act
  const paused = editorsPausedFrame(frames, 'breakpoint')

  // Assert
  assert.equal(paused, undefined)
})

// Value: protects=the frame the editor focuses once every frame above it is answered: a hole below the first qualifying frame does not hide it; fails_when=the hole rule stops at a hole that comes after the qualifying frame, so a stop whose deeper frames are not answered yet gets no hand-over; why_new=OCR6-1; seam=none; no_claim=none
test('a qualifying frame above a frame the adapter has not answered yet is the frame the editor focuses', () => {
  // Arrange: a deemphasized top frame, the learner's frame, then a frame not answered yet.
  const frames = [
    {
      id: 1,
      presentationHint: 'deemphasize',
      source: { path: '<node_internals>/fs', sourceReference: 3 },
    },
    { id: 2, presentationHint: 'normal', source: { path: '/app/actions.ts' } },
    undefined,
  ]

  // Act
  const paused = editorsPausedFrame(frames, 'exception')

  // Assert
  assert.equal(paused?.id, 2)
})
