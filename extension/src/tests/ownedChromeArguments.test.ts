import assert from 'node:assert/strict'
import { test } from 'node:test'

import { ownedChromeArguments } from '../runtimeSupport/utils/ownedChromeArguments'

// Value: protects=a run on a Linux desktop whose keyring is locked reaches the app (Cycle 0139 Ubuntu E1: every navigation stalled until `CDP Page.navigate timed out`); fails_when=a Chrome Codebook spawns (extension run, address probe or setup browser) is started without `--password-store=basic`; no_claim=Chrome honoring the switch, which the Ubuntu native rerun checks
test('every Chrome Codebook spawns keeps its cookie key out of the OS keyring, whether headless on a port or headed on a pipe', () => {
  // Arrange
  const extensionRun = {
    profile: '/p',
    debugging: 'port',
    headless: true,
    startUrl: 'about:blank',
  } as const
  const setupBrowser = {
    profile: '/s',
    debugging: 'pipe',
    headless: false,
    startUrl: 'about:blank',
  } as const

  // Act
  const extensionRunArguments = ownedChromeArguments(extensionRun)
  const setupBrowserArguments = ownedChromeArguments(setupBrowser)

  // Assert
  assert.equal(extensionRunArguments.includes('--password-store=basic'), true)
  assert.equal(setupBrowserArguments.includes('--password-store=basic'), true)
})

// Value: protects=the switch never displaces the start page Chrome opens; fails_when=the switch lands after the start URL, where Chrome reads it as a second page to open; no_claim=none beyond protects
test('the keyring switch comes before the profile and the start page, so Chrome reads it as a switch', () => {
  // Arrange
  const options = {
    profile: '/p',
    debugging: 'port',
    headless: true,
    startUrl: 'about:blank',
  } as const

  // Act
  const argumentsOfLaunch = ownedChromeArguments(options)

  // Assert
  assert.deepEqual(argumentsOfLaunch, [
    '--remote-debugging-port=0',
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--password-store=basic',
    '--user-data-dir=/p',
    'about:blank',
  ])
})
