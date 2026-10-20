import assert from 'node:assert/strict'
import { test } from 'node:test'

import { savedStudyIdentityLine } from '../utils/savedStudyIdentityLine'
import { studyRemovalMessages } from '../utils/studyRemovalMessages'

// Value: protects=the dialog, the status line and the failures of a removal say what is true and what to do next; fails_when=a sentence drifts or promises a count the library cannot give; why_new=removal texts are new; seam=none
test('a removal is worded with the Trash, the room it left and the next step when it made room for a refused run', () => {
  // Arrange
  const messages = studyRemovalMessages('Trash')
  // Act / Assert
  assert.equal(messages.confirmTitle, 'Move this saved study to the Trash?')
  assert.equal(messages.confirmButton, 'Move to Trash')
  assert.equal(
    messages.confirmDetail(
      'Repository browser study · 9/20/2026 · demonstrated · 22222222',
    ),
    'Repository browser study · 9/20/2026 · demonstrated · 22222222\n\nAny saved recording moves with it, and so does the raw evidence of its run unless another Codebook window may still be using it. What you marked as understood is kept. Repository Wiki links to this study will show as unavailable.',
  )
  assert.equal(messages.moving, 'Moving the saved study to the Trash…')
  assert.equal(
    messages.moved({ count: 63, limit: 64 }, false),
    'Saved study moved to the Trash. The library now holds 63 of 64 saved studies.',
  )
  assert.equal(
    messages.moved({ count: 255, limit: 256 }, true),
    'Saved study moved to the Trash. The library now holds 255 of 256 saved studies. Ask your editor agent to start the run again.',
  )
  assert.equal(
    messages.moved({ count: 3 }, false),
    'Saved study moved to the Trash.',
  )
  assert.equal(
    messages.moved({ count: 63, limit: 64 }, true, true),
    "Saved study moved to the Trash. The library now holds 63 of 64 saved studies. Ask your editor agent to start the run again. The run's raw evidence was left in place because its Codebook window may still be open.",
  )
  assert.equal(
    messages.nothingMoved('EPERM: operation not permitted'),
    'The saved study could not be moved to the Trash. Nothing was deleted. EPERM: operation not permitted',
  )
  assert.equal(
    messages.partlyMoved('EPERM: operation not permitted'),
    'The saved study was only partly moved to the Trash; delete it again to finish. EPERM: operation not permitted',
  )
  assert.equal(
    messages.lockNotReleased('EPERM: operation not permitted, unlink'),
    'Learning storage lock could not be released after the removal: EPERM: operation not permitted, unlink',
  )
})

// Value: protects=Windows learners read the word their system uses in every removal text; fails_when=one text bypasses the platform word; why_new=removal texts are new; seam=none
test('on Windows every removal text says Recycle Bin', () => {
  // Arrange
  const messages = studyRemovalMessages('Recycle Bin')
  // Act / Assert
  assert.equal(
    messages.confirmTitle,
    'Move this saved study to the Recycle Bin?',
  )
  assert.equal(messages.confirmButton, 'Move to Recycle Bin')
  assert.equal(
    messages.confirmDetail('Repository browser study'),
    'Repository browser study\n\nAny saved recording moves with it, and so does the raw evidence of its run unless another Codebook window may still be using it. What you marked as understood is kept. Repository Wiki links to this study will show as unavailable.',
  )
  assert.equal(messages.moving, 'Moving the saved study to the Recycle Bin…')
  assert.equal(
    messages.moved({ count: 1, limit: 2 }, false),
    'Saved study moved to the Recycle Bin. The library now holds 1 of 2 saved studies.',
  )
  assert.equal(
    messages.nothingMoved('locked'),
    'The saved study could not be moved to the Recycle Bin. Nothing was deleted. locked',
  )
  assert.equal(
    messages.partlyMoved('locked'),
    'The saved study was only partly moved to the Recycle Bin; delete it again to finish. locked',
  )
})

// Value: protects=the confirmation names the study with the same parts its list entry shows; fails_when=the dialog names another label, outcome or id tail than the list; why_new=the host builds this line itself; seam=none
test('the confirmation names a saved study by its label, saved date, outcome and the last eight characters of its id', () => {
  // Arrange
  const savedAt = '2026-09-20T00:00:10.000Z'
  // Act
  const configured = savedStudyIdentityLine({
      id: '11111111-1111-4111-8111-111111111111_22222222-2222-4222-8222-222222222222',
      profile: 'repository-browser',
      format: 'v3',
      savedAt,
      outcome: 'demonstrated',
    }),
    legacy = savedStudyIdentityLine({
      id: '11111111-1111-4111-8111-111111111111_33333333-3333-4333-8333-3333abcdef01',
      profile: undefined,
      format: 'legacy-v1',
      savedAt,
      outcome: 'Unsupported historical format; original file preserved',
    })
  // Assert: only the date's rendering depends on the machine's locale.
  assert.equal(
    configured,
    `Repository browser study · ${new Date(savedAt).toLocaleString()} · demonstrated · 22222222`,
  )
  assert.equal(
    legacy,
    `Unknown scenario (legacy) · ${new Date(savedAt).toLocaleString()} · Unsupported historical format; original file preserved · abcdef01`,
  )
})

// Value: protects=after a removal on a library whose limit was lowered below its stored count, the learner reads how many more studies must go; fails_when=the line reads "holds 69 of 64 saved studies." and names no next step (0038-F16); why_new=the count sentence was only tested below the limit; seam=none
test('the moved line of a library still at or above its limit says that it is still full and how many more studies must be deleted', () => {
  // Arrange
  const messages = studyRemovalMessages('Trash')
  // Act
  const aboveLimit = messages.moved({ count: 69, limit: 64 }, false),
    atLimit = messages.moved({ count: 64, limit: 64 }, false)
  // Assert
  assert.equal(
    aboveLimit,
    'Saved study moved to the Trash. The library now holds 69 of 64 saved studies and is still full; delete 6 more before another study can be saved.',
  )
  assert.equal(
    atLimit,
    'Saved study moved to the Trash. The library now holds 64 of 64 saved studies and is still full; delete 1 more before another study can be saved.',
  )
})

// Value: protects=a removal that stopped at a path it could not look at again says that nobody knows whether the study moved, and what to do; fails_when=the learner reads "Nothing was deleted" or "only partly moved" for a study that may be in the Trash, whole or in part (AD10); why_new=Cycle 0046 adversarial review AD10: the outcome of an unknown move is new; seam=none
test('a removal whose move could not be checked says that Codebook could not tell whether the study moved, in the Trash’s word, with the next step', () => {
  // Arrange
  const onMacAndLinux = studyRemovalMessages('Trash'),
    onWindows = studyRemovalMessages('Recycle Bin')
  // Act
  const lines = {
    trash: onMacAndLinux.moveUnknown('EACCES: permission denied'),
    recycleBin: onWindows.moveUnknown('EACCES: permission denied'),
  }
  // Assert
  assert.deepEqual(lines, {
    trash:
      'Codebook could not tell whether the saved study was moved to the Trash; delete it again to finish. EACCES: permission denied',
    recycleBin:
      'Codebook could not tell whether the saved study was moved to the Recycle Bin; delete it again to finish. EACCES: permission denied',
  })
})

// Value: protects=the dialog about a recording whose writer this computer cannot confirm says plainly where it may still be recorded, asks with the verb of its question, and says what each answer does; fails_when=the button reads "Remove Anyway" under a question about a move (PD2), the detail puts two ideas in one sentence or promises that nothing is lost when the writer is this computer under an earlier name (CX15, PD3), or a writer of this computer is called one of another computer (PD3); why_new=Cycle 0046 design review PD2 and PD3, and Codex review CX15; seam=none
test('the dialog about a recording whose writer this computer cannot confirm names where it may still run, asks with Move to Trash Anyway, and says what is lost and what Cancel keeps', () => {
  // Arrange
  const messages = studyRemovalMessages('Trash'),
    onWindows = studyRemovalMessages('Recycle Bin')
  const ofOldLaptop = {
      host: 'old-laptop.local',
      startedAt: '10/1/2026, 10:00:00 AM',
      place: 'another-computer',
    } as const,
    ofThisComputer = {
      host: 'workstation',
      startedAt: '10/1/2026, 10:00:00 AM',
      place: 'this-computer',
    } as const
  // Act
  const dialogs = {
    anotherComputer: {
      title: messages.unconfirmedWriterTitle([ofOldLaptop]),
      detail: messages.unconfirmedWriterDetail([ofOldLaptop]),
    },
    thisComputer: {
      title: messages.unconfirmedWriterTitle([ofThisComputer]),
      detail: messages.unconfirmedWriterDetail([ofThisComputer]),
    },
    button: messages.unconfirmedWriterButton,
    buttonOnWindows: onWindows.unconfirmedWriterButton,
  }
  // Assert
  assert.deepEqual(dialogs, {
    anotherComputer: {
      title:
        "This study's recording may still be in use on another computer. Move the study to the Trash anyway?",
      detail:
        'Its recording was started on old-laptop.local at 10/1/2026, 10:00:00 AM. Codebook cannot tell from this computer whether an editor window still records it or still has to save it. If a window still records it or still has to save it, on that computer or on this one, the recording is lost. If none does, nothing is lost. Cancel keeps the study and its recording as they are.',
    },
    thisComputer: {
      title:
        "This study's recording may still be in use in another editor window. Move the study to the Trash anyway?",
      detail:
        'Its recording was started on workstation at 10/1/2026, 10:00:00 AM. Codebook cannot tell whether an editor window of this computer still records it or still has to save it. If a window still records it or still has to save it, the recording is lost. If none does, nothing is lost. Cancel keeps the study and its recording as they are.',
    },
    button: 'Move to Trash Anyway',
    buttonOnWindows: 'Move to Recycle Bin Anyway',
  })
})

// Value: protects=the learner reads every recording a removal would move although its writer may still run, before agreeing to it; fails_when=the detail names one recording of several, or words several as one (AD6); why_new=Cycle 0046 adversarial review AD6; seam=none
test('the dialog about several recordings whose writers this computer cannot confirm names each host and start, and words them as several', () => {
  // Arrange
  const messages = studyRemovalMessages('Trash')
  // Act
  const details = {
    anotherComputerFirst: messages.unconfirmedWriterDetail([
      {
        host: 'host-one',
        startedAt: '10/1/2026, 10:00:00 AM',
        place: 'another-computer',
      },
      {
        host: 'workstation',
        startedAt: '10/17/2026, 10:00:00 AM',
        place: 'this-computer',
      },
    ]),
    thisComputerOnly: messages.unconfirmedWriterDetail([
      {
        host: 'workstation',
        startedAt: '10/1/2026, 10:00:00 AM',
        place: 'this-computer',
      },
      {
        host: 'workstation',
        startedAt: '10/17/2026, 10:00:00 AM',
        place: 'this-computer',
      },
    ]),
  }
  // Assert
  assert.deepEqual(details, {
    anotherComputerFirst:
      'Its recordings were started on host-one at 10/1/2026, 10:00:00 AM and on workstation at 10/17/2026, 10:00:00 AM. Codebook cannot tell from this computer whether an editor window still records them or still has to save them. If a window still records one of them or still has to save it, on another computer or on this one, that recording is lost. If none does, nothing is lost. Cancel keeps the study and its recordings as they are.',
    thisComputerOnly:
      'Its recordings were started on workstation at 10/1/2026, 10:00:00 AM and on workstation at 10/17/2026, 10:00:00 AM. Codebook cannot tell whether an editor window of this computer still records them or still has to save them. If a window still records one of them or still has to save it, that recording is lost. If none does, nothing is lost. Cancel keeps the study and its recordings as they are.',
  })
})

// Value: protects=the learner reading the title of the dialog about several recordings, which names how many and only the places that apply; fails_when=the title takes the first writer's place alone, so it is singular for several recordings and names only another computer when one of them is of this computer (S6); why_new=Cycle 0046 third review PD3-4 (S6); seam=none
test('the title of the dialog about several recordings says some of them may still be in use, on another computer, in another editor window, or in both', () => {
  // Arrange
  const messages = studyRemovalMessages('Trash')
  const ofHostOne = {
      host: 'host-one',
      startedAt: '10/1/2026, 10:00:00 AM',
      place: 'another-computer',
    } as const,
    ofHostTwo = {
      host: 'host-two',
      startedAt: '10/2/2026, 10:00:00 AM',
      place: 'another-computer',
    } as const,
    ofThisComputer = {
      host: 'workstation',
      startedAt: '10/17/2026, 10:00:00 AM',
      place: 'this-computer',
    } as const
  // Act
  const titles = {
    bothOnOtherComputers: messages.unconfirmedWriterTitle([
      ofHostOne,
      ofHostTwo,
    ]),
    bothOnThisComputer: messages.unconfirmedWriterTitle([
      ofThisComputer,
      ofThisComputer,
    ]),
    inBothPlaces: messages.unconfirmedWriterTitle([ofHostOne, ofThisComputer]),
  }
  // Assert
  assert.deepEqual(titles, {
    bothOnOtherComputers:
      "Some of this study's recordings may still be in use on another computer. Move the study to the Trash anyway?",
    bothOnThisComputer:
      "Some of this study's recordings may still be in use in another editor window. Move the study to the Trash anyway?",
    inBothPlaces:
      "Some of this study's recordings may still be in use on another computer or in another editor window. Move the study to the Trash anyway?",
  })
})

// Value: protects=the learner reading the dialog about a recording whose header or writer record Codebook could not read now, which names no host and no start; fails_when=the dialog names a host and a start the recording never gave, says nothing of the failed read, or calls such a recording one of another computer, so the learner moves the study of a window that may still save it without knowing why Codebook asks; why_new=Cycle 0047 row 251 (P3CXA-C1): a recording read by a look that may have failed is no longer finished, and Delete asks about it; seam=none
test('the dialog about a recording whose files Codebook could not read says so and why, names it as one in another editor window, and speaks of the other recordings beside named ones', () => {
  // Arrange
  const messages = studyRemovalMessages('Trash')
  const unreadable = { place: 'unreadable' } as const,
    ofOldLaptop = {
      host: 'old-laptop.local',
      startedAt: '10/1/2026, 10:00:00 AM',
      place: 'another-computer',
    } as const
  // Act
  const dialogs = {
    one: {
      title: messages.unconfirmedWriterTitle([unreadable]),
      detail: messages.unconfirmedWriterDetail([unreadable]),
    },
    two: {
      title: messages.unconfirmedWriterTitle([unreadable, unreadable]),
      detail: messages.unconfirmedWriterDetail([unreadable, unreadable]),
    },
    besideOneOfAnotherComputer: {
      title: messages.unconfirmedWriterTitle([ofOldLaptop, unreadable]),
      detail: messages.unconfirmedWriterDetail([ofOldLaptop, unreadable]),
    },
  }
  // Assert
  assert.deepEqual(dialogs, {
    one: {
      title:
        "This study's recording may still be in use in another editor window. Move the study to the Trash anyway?",
      detail:
        'Codebook could not read the files of its recording now. A virus scanner may hold them, or another editor window may still record it or still have to save it. If a window still records it or still has to save it, the recording is lost. If none does, nothing is lost. Cancel keeps the study and its recording as they are.',
    },
    two: {
      title:
        "Some of this study's recordings may still be in use in another editor window. Move the study to the Trash anyway?",
      detail:
        'Codebook could not read the files of its recordings now. A virus scanner may hold them, or another editor window may still record them or still have to save them. If a window still records one of them or still has to save it, that recording is lost. If none does, nothing is lost. Cancel keeps the study and its recordings as they are.',
    },
    besideOneOfAnotherComputer: {
      title:
        "Some of this study's recordings may still be in use on another computer or in another editor window. Move the study to the Trash anyway?",
      detail:
        'Its recording was started on old-laptop.local at 10/1/2026, 10:00:00 AM. Codebook cannot tell from this computer whether an editor window still records it or still has to save it. Codebook could not read the files of its other recording now. A virus scanner may hold them, or another editor window may still record it or still have to save it. If a window still records one of them or still has to save it, on another computer or on this one, that recording is lost. If none does, nothing is lost. Cancel keeps the study and its recordings as they are.',
    },
  })
})
