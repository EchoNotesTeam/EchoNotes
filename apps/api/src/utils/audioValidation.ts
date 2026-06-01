/**
 * Audio file validation rules shared between the route handler and tests.
 */
export const ALLOWED_EXTENSIONS = new Set([
  ".wav", ".mp3", ".flac", ".ogg", ".m4a", ".aac",
])

export const ALLOWED_MIMES = new Set([
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  "audio/ogg",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
  "audio/vnd.wave",
  // Generic binary — some OS/browsers send this for audio files
  "application/octet-stream",
])

export function isAllowedExtension(filename: string): boolean {
  const ext = filename.slice(filename.lastIndexOf(".")).toLowerCase()
  return ALLOWED_EXTENSIONS.has(ext)
}

export function isAllowedMime(mime: string): boolean {
  return ALLOWED_MIMES.has(mime)
}
