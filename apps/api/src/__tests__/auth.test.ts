import { describe, it, expect } from 'vitest'
import { signJwt, verifyJwt } from '../routes/auth.js'

describe('signJwt / verifyJwt', () => {
  it('round-trip: sign then verify returns the original userId', async () => {
    const token = await signJwt({ userId: 'user-abc-123' })
    const { userId } = await verifyJwt(token)
    expect(userId).toBe('user-abc-123')
  })

  it('produces a string with three JWT segments', async () => {
    const token = await signJwt({ userId: 'x' })
    expect(token.split('.')).toHaveLength(3)
  })

  it('rejects a token with a tampered signature', async () => {
    const token = await signJwt({ userId: 'user-1' })
    // Corrupt the last few chars (signature segment)
    const tampered = token.slice(0, -8) + 'XXXXXXXX'
    await expect(verifyJwt(tampered)).rejects.toThrow()
  })

  it('rejects a token signed with a completely different key', async () => {
    // Header.payload with a fake signature — HS256 structure but wrong key
    const fakeToken =
      'eyJhbGciOiJIUzI1NiJ9' +
      '.eyJ1c2VySWQiOiJoYWNrZXIifQ' +
      '.wrongsignatureXXXXXXXXXXXXXXXXXXXXX'
    await expect(verifyJwt(fakeToken)).rejects.toThrow()
  })

  it('rejects a completely malformed token', async () => {
    await expect(verifyJwt('not.a.jwt')).rejects.toThrow()
  })
})
