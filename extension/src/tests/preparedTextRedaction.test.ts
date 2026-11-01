import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { ChromeExtensionConfiguration } from '../chromeExtensionConfigSchemas'
import { StudyService } from '../service'
import { isSecretControl } from '../utils/isSecretControl'
import { redactExtensionInputs } from '../utils/redactExtensionInputs'
import { redactPreparedTexts } from '../utils/redactPreparedTexts'

// protects=each control kind that must keep its typed text out of stored forms is recognized (password type, secret name or id, one autocomplete token each) and ordinary controls are not; fails_when=a token is missing or an ordinary email or search control is masked; no_claim=what a real page reports for these attributes
for (const [description, control, expected] of [
  ['type password', { type: 'password' }, true],
  ['secret name', { type: 'text', name: 'api_token' }, true],
  ['secret id', { type: 'text', id: 'accessToken' }, true],
  ['autocomplete current-password', { autocomplete: 'current-password' }, true],
  ['autocomplete new-password', { autocomplete: 'new-password' }, true],
  ['autocomplete one-time-code', { autocomplete: 'one-time-code' }, true],
  ['autocomplete cc-number', { autocomplete: 'cc-number' }, true],
  ['autocomplete cc-csc', { autocomplete: 'section-pay cc-csc' }, true],
  ['an email control', { type: 'email', name: 'email' }, false],
  ['a search box', { type: 'search', id: 'query' }, false],
  ['autocomplete email', { autocomplete: 'email' }, false],
] as const)
  test(`a control with ${description} is ${expected ? 'secret' : 'not secret'}`, () => {
    // Arrange
    // Act
    const secret = isSecretControl(control)
    // Assert
    assert.equal(secret, expected)
  })

// protects=the canonical form masks every text not known plain while the view form shows [pending] only for an unresolved text; fails_when=[pending] reaches the canonical form or an unresolved text stays readable in it; no_claim=hashing, which the saved study tests cover
test('the canonical form never holds [pending] and masks an unresolved text, the view form shows it', () => {
  // Arrange
  const inputs = [
    { selector: '#a', text: 'plain-text' },
    { selector: '#b', text: 'secret-text' },
    { selector: '#c', text: 'later-text' },
  ]
  const states = ['plain', 'secret'] as const
  // Act
  const canonical = redactPreparedTexts(inputs, states, 'canonical')
  const view = redactPreparedTexts(inputs, states, 'view')
  // Assert
  assert.deepEqual(
    canonical.map((input) => input.text),
    ['plain-text', '[masked]', '[masked]'],
  )
  assert.deepEqual(
    view.map((input) => input.text),
    ['plain-text', '[masked]', '[pending]'],
  )
})

const EXTENSION_CONFIGURATION = {
  clicks: [
    {
      title: 'Sign in',
      selector: '#go',
      kind: 'click',
      inputs: [
        { selector: '#user', text: 'learner@example.invalid' },
        { selector: '#pw', text: 'hunter2-extension' },
      ],
    },
  ],
} as unknown as ChromeExtensionConfiguration

// protects=an extension click's password input is masked in the manifest resource's configuration and its hash, and pending before it is typed; fails_when=the served manifest keeps the typed password or the hash changes with the password; no_claim=the resource route and the history are not run; the saved extension record holds no input text by construction
test('an extension password input is masked in the served manifest configuration and its hash ignores the password', () => {
  // Arrange
  const recordFor = (inputStates: ('plain' | 'secret')[][]) => ({
    chromeExtension: {
      prepared: { configuration: EXTENSION_CONFIGURATION },
      run: { view: () => ({ inputStates }) },
    },
  })
  const fieldsOf = (record: ReturnType<typeof recordFor>) =>
    // The method reads only the record it is given.
    StudyService.prototype.extensionManifestFields.call(
      undefined,
      record as never,
    )
  // Act
  const pending = fieldsOf(recordFor([]))
  const typed = fieldsOf(recordFor([['plain', 'secret']]))
  const otherPassword = redactExtensionInputs(
    {
      clicks: [
        {
          ...EXTENSION_CONFIGURATION.clicks[0]!,
          inputs: [
            { selector: '#user', text: 'learner@example.invalid' },
            { selector: '#pw', text: 'another-password' },
          ],
        },
      ],
    } as unknown as ChromeExtensionConfiguration,
    [['plain', 'secret']],
    'canonical',
  )
  // Assert
  assert.deepEqual(pending?.configuration.clicks[0]?.inputs, [
    { selector: '#user', text: '[pending]' },
    { selector: '#pw', text: '[pending]' },
  ])
  assert.deepEqual(typed?.configuration.clicks[0]?.inputs, [
    { selector: '#user', text: 'learner@example.invalid' },
    { selector: '#pw', text: '[masked]' },
  ])
  assert.equal(JSON.stringify(typed).includes('hunter2-extension'), false)
  assert.equal(
    JSON.stringify(otherPassword).includes('another-password'),
    false,
  )
})
