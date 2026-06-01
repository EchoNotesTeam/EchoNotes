import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../utils/frontmatter.js'

describe('parseFrontmatter', () => {
  it('parses a well-formed frontmatter block', () => {
    const raw = `---
title: My First Post
date: 2026-05-01
author: Test User
excerpt: A short description
---
Body content here.`

    const { meta, content } = parseFrontmatter(raw)
    expect(meta['title']).toBe('My First Post')
    expect(meta['date']).toBe('2026-05-01')
    expect(meta['author']).toBe('Test User')
    expect(meta['excerpt']).toBe('A short description')
    expect(content).toBe('Body content here.')
  })

  it('returns empty meta and the original string when no --- present', () => {
    const raw = 'Just plain content without any frontmatter'
    const { meta, content } = parseFrontmatter(raw)
    expect(meta).toEqual({})
    expect(content).toBe(raw)
  })

  it('returns empty meta when the closing --- is missing', () => {
    const raw = `---
title: Orphan Post`
    const { meta, content } = parseFrontmatter(raw)
    expect(meta).toEqual({})
    expect(content).toBe(raw)
  })

  it('strips double quotes from values', () => {
    const raw = `---
title: "Quoted Title"
---
Content`
    const { meta } = parseFrontmatter(raw)
    expect(meta['title']).toBe('Quoted Title')
  })

  it('strips single quotes from values', () => {
    const raw = `---
author: 'Single Quoted Author'
---
Content`
    const { meta } = parseFrontmatter(raw)
    expect(meta['author']).toBe('Single Quoted Author')
  })

  it('ignores lines without a colon separator', () => {
    const raw = `---
title: Valid
this-line-has-no-colon
---
Content`
    const { meta } = parseFrontmatter(raw)
    expect(meta['title']).toBe('Valid')
    expect(Object.keys(meta)).toHaveLength(1)
  })

  it('handles values that contain colons (only splits on first colon)', () => {
    const raw = `---
url: https://example.com/path
---
Content`
    const { meta } = parseFrontmatter(raw)
    expect(meta['url']).toBe('https://example.com/path')
  })

  it('trims whitespace from keys and values', () => {
    const raw = `---
  title  :   Padded Value
---
Content`
    const { meta } = parseFrontmatter(raw)
    expect(meta['title']).toBe('Padded Value')
  })

  it('returns empty content string for empty body after ---', () => {
    const raw = `---
title: No Body
---`
    const { content } = parseFrontmatter(raw)
    expect(content).toBe('')
  })
})
