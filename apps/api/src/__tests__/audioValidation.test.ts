import { describe, it, expect } from 'vitest'
import { isAllowedExtension, isAllowedMime, ALLOWED_EXTENSIONS } from '../utils/audioValidation.js'

describe('isAllowedExtension', () => {
  it.each(['.wav', '.mp3', '.flac', '.ogg', '.m4a', '.aac'])(
    'allows %s',
    (ext) => {
      expect(isAllowedExtension(`recording${ext}`)).toBe(true)
    }
  )

  it.each(['.exe', '.txt', '.mp4', '.avi', '.pdf', '.jpg'])(
    'blocks %s',
    (ext) => {
      expect(isAllowedExtension(`file${ext}`)).toBe(false)
    }
  )

  it('is case-insensitive', () => {
    expect(isAllowedExtension('track.WAV')).toBe(true)
    expect(isAllowedExtension('track.MP3')).toBe(true)
  })

  it('handles filenames with multiple dots correctly', () => {
    expect(isAllowedExtension('my.recording.track.wav')).toBe(true)
    expect(isAllowedExtension('bad.file.exe')).toBe(false)
  })

  it('the ALLOWED_EXTENSIONS set has exactly 6 entries', () => {
    expect(ALLOWED_EXTENSIONS.size).toBe(6)
  })
})

describe('isAllowedMime', () => {
  it.each([
    'audio/mpeg',
    'audio/wav',
    'audio/x-wav',
    'audio/flac',
    'audio/ogg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/aac',
    'audio/vnd.wave',
    'application/octet-stream',
  ])('allows %s', (mime) => {
    expect(isAllowedMime(mime)).toBe(true)
  })

  it.each(['video/mp4', 'image/png', 'text/plain', 'application/json'])(
    'blocks %s',
    (mime) => {
      expect(isAllowedMime(mime)).toBe(false)
    }
  )
})
