import assert from 'node:assert/strict'
import { test } from 'node:test'

import { adoptOwnQuietCopyShow } from '../utils/adoptOwnQuietCopyShow'

// Value: protects=an agent's read of the open Wiki beside Cursor's chat part, whose own copy shown without the keyboard makes Cursor name its chat part's group: that name change becomes the retained focus; fails_when=the change is not taken into the retained focus, so the reader refuses its own show as newer learner input; why_new=Cycle 0046 row 696 (C60 c60-cu-7d2); seam=none
test("a group name change the reader's own quiet copy show explains, beside the same absent text editor, becomes the retained focus", () => {
  // Arrange: no text editor was active (the chat input had the keyboard), and the editor named group 1 with the first copy in front.
  const retained = {
    editor: '[null,null,null,null]',
    group:
      '[1,"module.ts",{"uri":"codebook-repository-source://w/a/1/m/0/module.ts"}]',
  }
  const chatPartNamed = {
    editor: '[null,null,null,null]',
    group: '[3,"New Agent",null]',
  }

  // Act
  const adopted = adoptOwnQuietCopyShow(retained, chatPartNamed, true)

  // Assert
  assert.deepEqual(adopted, {
    editor: '[null,null,null,null]',
    group: '[3,"New Agent",null]',
  })
})

// Value: protects=the learner's newer input while an agent's read of the open Wiki shows its copy: a text editor that became active, and a group the reader's show does not explain, stay changes the receipt refuses; fails_when=a learner's click into a file or into another group is taken into the retained focus, and the agent's open goes on over the learner's choice; why_new=Cycle 0046 row 696 (the bound of the accepted name change); seam=none
test("a changed text editor, a group the reader's show does not explain, or an unestablished focus stays as it was", () => {
  // Arrange
  const retained = {
    editor: '[null,null,null,null]',
    group:
      '[1,"module.ts",{"uri":"codebook-repository-source://w/a/1/m/0/module.ts"}]',
  }
  const learnersFile = {
    editor: '["file:///repository/notes.ts",1,2,[]]',
    group: '[2,"notes.ts",{"uri":"file:///repository/notes.ts"}]',
  }
  const unexplainedGroup = {
    editor: '[null,null,null,null]',
    group:
      '[2,"codebook · Repository Wiki",{"viewType":"codebook.repositoryWiki"}]',
  }

  // Act
  const results = {
    learnersFile: adoptOwnQuietCopyShow(retained, learnersFile, true),
    unexplainedGroup: adoptOwnQuietCopyShow(retained, unexplainedGroup, false),
    unestablished: adoptOwnQuietCopyShow(undefined, unexplainedGroup, true),
  }

  // Assert
  assert.deepEqual(results, {
    learnersFile: retained,
    unexplainedGroup: retained,
    unestablished: undefined,
  })
})
