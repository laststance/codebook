import assert from 'node:assert/strict'
import { test } from 'node:test'

import { withoutBootTime } from '../utils/withoutBootTime'

// Value: protects=a marker, a descriptor or a profile marker of a Mac judged after its host name changed within one boot: the boot session's id stays, so a record that names this machine by the digest of its machine id is still this machine's and is judged by its process; fails_when=the identity keeps the boot time beside the id, which a correction of the clock moves, or drops the id with the time (S4); why_new=Cycle 0046 third review S4: markers and the sweep carry the exact boot id; seam=none
test('without its boot time an identity keeps its boot’s id alone, and a boot time alone goes', () => {
  // Act
  const identities = {
    ofAMac: withoutBootTime({
      hostname: 'laptop.lan',
      boot: {
        id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14',
        startedAtMs: 1_790_000_000_000,
      },
    }),
    ofLinux: withoutBootTime({
      hostname: 'workstation',
      boot: { id: '0c1d7a52-6f0e-4d3b-9a57-3f6f0a1b2c3d' },
    }),
    ofWindows: withoutBootTime({
      hostname: 'desktop',
      boot: { startedAtMs: 1_790_000_000_000 },
    }),
  }
  // Assert
  assert.deepEqual(identities, {
    ofAMac: {
      hostname: 'laptop.lan',
      boot: { id: '8C9E3B1A-4D2F-4E6B-9A71-0F3C2D5E8B14' },
    },
    ofLinux: {
      hostname: 'workstation',
      boot: { id: '0c1d7a52-6f0e-4d3b-9a57-3f6f0a1b2c3d' },
    },
    ofWindows: { hostname: 'desktop', boot: undefined },
  })
})
