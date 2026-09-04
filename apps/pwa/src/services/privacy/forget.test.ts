import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createKeyManager, memoryKeyStore } from '../crypto/keys.ts'
import { createPlateVault, memoryPlateStore } from '../crypto/plate.ts'
import { closeFwmDb, createRepositories, openFwmDb } from '../db/index.ts'
import type { FwmDatabase } from '../db/repositories/support.ts'
import type { MemoryIndexedDB } from '../db/testing/memory-idb.ts'
import { installMemoryIndexedDB } from '../db/testing/memory-idb.ts'
import { describeForgetReport, forgetLocalIdentity } from './forget.ts'

let memory: MemoryIndexedDB
let counter = 0

beforeAll(() => {
  memory = installMemoryIndexedDB()
})

afterAll(() => {
  memory.uninstall()
})

async function freshDb(): Promise<FwmDatabase> {
  return openFwmDb({ name: `fwm-forget-${String(++counter)}` })
}

function freshVault() {
  // `claimDurability: 'persistent'` is the documented test-harness escape: node
  // has no IndexedDB, and the key manager correctly refuses an ephemeral store
  // because a key that does not survive a reload cannot back evidence. Product
  // code must never pass it.
  const store = memoryKeyStore({ claimDurability: 'persistent' })
  return {
    store,
    vault: createPlateVault({
      keys: createKeyManager({ keyStore: store }),
      store: memoryPlateStore(),
    }),
  }
}

describe('forgetLocalIdentity', () => {
  it('destroys ciphertext and the keys that could read it', async () => {
    const db = await freshDb()
    const { vault } = freshVault()

    await vault.seal('HVK 8842')
    await vault.seal('471 TRB')
    expect(await vault.list()).toHaveLength(2)

    const report = await forgetLocalIdentity({ db, vault })

    expect(report.vaultKeysDestroyed).toBe(true)
    expect(report.vaultKeyError).toBeUndefined()
    expect(await vault.list()).toHaveLength(0)

    closeFwmDb(db)
  })

  it('leaves nothing decryptable behind', async () => {
    const db = await freshDb()
    const { vault } = freshVault()

    const sealed = await vault.seal('HVK 8842')
    // Sanity: it really was readable before the wipe, so the assertion after
    // the wipe is meaningful rather than vacuously true. The vault returns the
    // plate as the user typed it - normalisation is for the blind index, not
    // for what a person reads back off their own screen.
    expect(await vault.open(sealed)).toBe('HVK 8842')

    await forgetLocalIdentity({ db, vault })

    // The ciphertext is gone from the store...
    expect(await vault.openById(sealed.id)).toBeUndefined()
    // ...and a caller holding a stale copy of the record cannot read it either,
    // because the key it was sealed under no longer exists.
    await expect(vault.open(sealed)).rejects.toThrow()

    closeFwmDb(db)
  })

  it('is idempotent - a second press reports zeroes and does not throw', async () => {
    const db = await freshDb()
    const { vault } = freshVault()
    await vault.seal('HVK 8842')

    await forgetLocalIdentity({ db, vault })
    const second = await forgetLocalIdentity({ db, vault })

    expect(second.plateCiphertextRows).toBe(0)
    expect(second.plateMatchRows).toBe(0)
    expect(second.vaultKeysDestroyed).toBe(true)

    closeFwmDb(db)
  })

  it('reports a key-store failure instead of claiming a clean wipe', async () => {
    const db = await freshDb()
    const { vault } = freshVault()
    await vault.seal('HVK 8842')

    const failing = {
      ...vault,
      destroyVault: () => Promise.reject(new Error('key store offline')),
    }

    const report = await forgetLocalIdentity({ db, vault: failing })

    expect(report.vaultKeysDestroyed).toBe(false)
    expect(report.vaultKeyError).toContain('ciphertext was removed')
    // The message must not carry the raw cause, which is raised from the code
    // path that handles plate material.
    expect(report.vaultKeyError).not.toContain('key store offline')

    closeFwmDb(db)
  })

  it('keeps signed evidence and says so', async () => {
    const db = await freshDb()
    const { vault } = freshVault()
    const repos = createRepositories(db)

    const report = await forgetLocalIdentity({ db, vault })

    // Whatever the fixture state, the contract is fixed: this operation never
    // deletes evidence, and the count it retains is reported rather than hidden.
    expect(report.signedReportsRemoved).toBe(0)
    expect(report.signedReportsRetained).toBe((await repos.reportChain.all()).length)

    closeFwmDb(db)
  })
})

describe('describeForgetReport', () => {
  it('states the failure rather than burying it', () => {
    const lines = describeForgetReport({
      plateCiphertextRows: 2,
      plateMatchRows: 2,
      secretSettingsRemoved: [],
      vaultKeyReferenceCleared: true,
      alerts: 5,
      trips: 1,
      photosRemoved: 0,
      signedReportsRemoved: 0,
      signedReportsRetained: 3,
      vaultKeysDestroyed: false,
      vaultKeyError: 'key store could not be cleared (Error); ciphertext was removed',
    })

    expect(lines.join('\n')).toContain('could NOT be destroyed')
    expect(lines.join('\n')).toContain('3 signed camera reports kept')
  })

  it('pluralises a single item correctly', () => {
    const lines = describeForgetReport({
      plateCiphertextRows: 1,
      plateMatchRows: 1,
      secretSettingsRemoved: [],
      vaultKeyReferenceCleared: true,
      alerts: 1,
      trips: 1,
      photosRemoved: 0,
      signedReportsRemoved: 0,
      signedReportsRetained: 0,
      vaultKeysDestroyed: true,
    })

    expect(lines[0]).toBe('1 encrypted plate deleted')
    expect(lines[3]).toBe('1 trip and 1 alert deleted')
    expect(lines[4]).toBe('0 attached photographs deleted')
  })

  it('says the pictures are gone on the same line that says the reports were kept', () => {
    // A user told only "2 signed camera reports kept" reasonably concludes the
    // photographs in them were kept as well. They were not, so the kept line
    // carries the correction rather than leaving it to be inferred from a
    // count several lines above.
    const lines = describeForgetReport({
      plateCiphertextRows: 0,
      plateMatchRows: 0,
      secretSettingsRemoved: [],
      vaultKeyReferenceCleared: true,
      alerts: 0,
      trips: 0,
      photosRemoved: 1,
      signedReportsRemoved: 0,
      signedReportsRetained: 2,
      vaultKeysDestroyed: true,
    })

    expect(lines).toContain('1 attached photograph deleted')
    expect(lines.join('\n')).toContain(
      '2 signed camera reports kept - deleting one breaks the chain for the rest. ' +
        'clear them separately. the photographs they named are gone - ' +
        'the signature covers the digest, not the picture.',
    )
  })

  it('does not tack the photo clause onto the kept line when there were no photos', () => {
    const lines = describeForgetReport({
      plateCiphertextRows: 0,
      plateMatchRows: 0,
      secretSettingsRemoved: [],
      vaultKeyReferenceCleared: true,
      alerts: 0,
      trips: 0,
      photosRemoved: 0,
      signedReportsRemoved: 0,
      signedReportsRetained: 1,
      vaultKeysDestroyed: true,
    })

    expect(lines).toContain('0 attached photographs deleted')
    expect(lines.join('\n')).not.toContain('the photographs they named are gone')
  })
})
