import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OrchestratorService } from '../services/orchestrator.js'

// Build a ReadableStream<Uint8Array> from string chunks, mimicking how the Go
// orchestrator streams SSE bytes — one or more chunks, then close.
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

// A fake `fetch` that returns the given SSE body (or a non-OK response).
function mockFetchStream(
  chunks: string[],
  init: { ok?: boolean; statusText?: string } = {},
) {
  const { ok = true, statusText = 'OK' } = init
  return vi.fn(async () =>
    ({
      ok,
      statusText,
      body: ok ? streamFromChunks(chunks) : null,
    }) as unknown as Response,
  )
}

describe('OrchestratorService.streamJobProgress', () => {
  let service: OrchestratorService

  beforeEach(() => {
    service = new OrchestratorService()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('parses multiple `data:` SSE events from a single chunk', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchStream([
        'data: {"stage":"loading","pct":5}\n\n' +
          'data: {"stage":"transcribing","pct":40}\n\n' +
          'data: {"stage":"done","pct":100,"done":true}\n\n',
      ]),
    )

    const events: unknown[] = []
    const errors: unknown[] = []
    service.streamJobProgress(
      'job-1',
      (e) => events.push(e),
      (err) => errors.push(err),
    )

    await vi.waitFor(() => expect(events).toHaveLength(3))
    expect(errors).toHaveLength(0)
    expect(events[0]).toEqual({ stage: 'loading', pct: 5 })
    expect(events[1]).toEqual({ stage: 'transcribing', pct: 40 })
    expect(events[2]).toMatchObject({ stage: 'done', done: true })
  })

  it('reassembles an event split across read() boundaries', async () => {
    // The JSON payload is delivered across two separate chunks; the parser must
    // buffer the partial line until the terminating newline arrives.
    vi.stubGlobal(
      'fetch',
      mockFetchStream(['data: {"stage":"quan', 'tizing","pct":60}\n\n']),
    )

    const events: unknown[] = []
    service.streamJobProgress(
      'job-2',
      (e) => events.push(e),
      () => {},
    )

    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toEqual({ stage: 'quantizing', pct: 60 })
  })

  it('ignores SSE comment lines and blank separators', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchStream([
        ': keep-alive comment\n\n' + 'data: {"stage":"notating","pct":80}\n\n',
      ]),
    )

    const events: unknown[] = []
    service.streamJobProgress(
      'job-3',
      (e) => events.push(e),
      () => {},
    )

    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toEqual({ stage: 'notating', pct: 80 })
  })

  it('silently skips a malformed JSON data line but keeps parsing valid ones', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchStream([
        'data: {not valid json\n\n' + 'data: {"stage":"ok","pct":10}\n\n',
      ]),
    )

    const events: unknown[] = []
    const errors: unknown[] = []
    service.streamJobProgress(
      'job-4',
      (e) => events.push(e),
      (err) => errors.push(err),
    )

    await vi.waitFor(() => expect(events).toHaveLength(1))
    expect(events[0]).toEqual({ stage: 'ok', pct: 10 })
    expect(errors).toHaveLength(0)
  })

  it('calls onError when the stream responds with a non-OK status', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchStream([], { ok: false, statusText: 'Internal Server Error' }),
    )

    const events: unknown[] = []
    const errors: unknown[] = []
    service.streamJobProgress(
      'job-5',
      (e) => events.push(e),
      (err) => errors.push(err),
    )

    await vi.waitFor(() => expect(errors).toHaveLength(1))
    expect(events).toHaveLength(0)
    expect(errors[0]).toBeInstanceOf(Error)
  })
})
