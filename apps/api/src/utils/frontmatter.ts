/**
 * Minimal YAML-like frontmatter parser.
 * Handles `key: value` pairs between --- delimiters.
 * No external dependencies — intentional for a lightweight blog feature.
 */
export function parseFrontmatter(raw: string): {
  meta: Record<string, string>
  content: string
} {
  if (!raw.startsWith("---")) {
    return { meta: {}, content: raw }
  }

  const end = raw.indexOf("\n---", 3)
  if (end === -1) {
    return { meta: {}, content: raw }
  }

  const yamlBlock = raw.slice(3, end).trim()
  const body = raw.slice(end + 4).trim()

  const meta: Record<string, string> = {}
  for (const line of yamlBlock.split("\n")) {
    const colon = line.indexOf(":")
    if (colon === -1) continue
    const key = line.slice(0, colon).trim()
    const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "")
    if (key) meta[key] = value
  }

  return { meta, content: body }
}
