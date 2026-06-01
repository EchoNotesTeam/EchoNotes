import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ref } from 'vue'
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'

// ─── WebSocket mock ───────────────────────────────────────────────────────────
// We stub the global WebSocket before importing the composable so the
// singleton uses our controlled fake instead of a real socket.

class MockWebSocket extends EventTarget {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3

  readyState = MockWebSocket.OPEN
  url: string
  sent: string[] = []

  constructor(url: string) {
    super()
    this.url = url
    // Emit 'open' asynchronously so the composable's listener runs
    setTimeout(() => this.dispatchEvent(new Event('open')), 0)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.readyState = MockWebSocket.CLOSED
    this.dispatchEvent(new Event('close'))
  }

  /** Helper: fire a message event as if the server sent it. */
  receive(data: unknown) {
    const ev = new MessageEvent('message', { data: JSON.stringify(data) })
    this.dispatchEvent(ev)
  }
}

// Track the last created instance so tests can call receive() on it.
let lastSocket: MockWebSocket | null = null

vi.stubGlobal('WebSocket', class extends MockWebSocket {
  constructor(url: string) {
    super(url)
    lastSocket = this
  }
})

// Import AFTER stubbing
import { useJobSocket, _resetForTesting } from '@/composables/useJobSocket.js'
import type { WsJobEvent } from '@echonotes/shared-types'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function useComposableInVue(
  jobId: ReturnType<typeof ref<string | null>>,
  handler: (e: WsJobEvent) => void,
) {
  const comp = defineComponent({
    setup() { useJobSocket(jobId, handler) },
    template: '<div />',
  })
  return mount(comp)
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('useJobSocket', () => {
  beforeEach(() => {
    _resetForTesting()
    lastSocket = null
    vi.clearAllMocks()
  })

  afterEach(() => {
    _resetForTesting()
  })

  it('connects to WebSocket when a jobId is provided', async () => {
    const jobId = ref<string | null>('job-abc')
    const handler = vi.fn()
    useComposableInVue(jobId, handler)

    // Let the async open event fire
    await vi.waitFor(() => expect(lastSocket).not.toBeNull())
    expect(lastSocket?.url).toContain('/api/ws')
  })

  it('sends subscribe_job message after the socket opens', async () => {
    const jobId = ref<string | null>('job-xyz')
    const handler = vi.fn()
    useComposableInVue(jobId, handler)

    await vi.waitFor(() => {
      expect(lastSocket?.sent).toContainEqual(
        JSON.stringify({ type: 'subscribe_job', job_id: 'job-xyz' }),
      )
    })
  })

  it('calls the handler when a job_progress event arrives', async () => {
    const jobId = ref<string | null>('job-1')
    const handler = vi.fn()
    useComposableInVue(jobId, handler)

    await vi.waitFor(() => expect(lastSocket).not.toBeNull())
    lastSocket!.receive({ type: 'job_progress', job_id: 'job-1', stage: 'transcribing', pct: 30 })

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'job_progress', pct: 30 }),
    )
  })

  it('calls the handler when a job_done event arrives', async () => {
    const jobId = ref<string | null>('job-2')
    const handler = vi.fn()
    useComposableInVue(jobId, handler)

    await vi.waitFor(() => expect(lastSocket).not.toBeNull())
    lastSocket!.receive({ type: 'job_done', job_id: 'job-2', sheet_id: 'sheet-99' })

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'job_done', sheet_id: 'sheet-99' }),
    )
  })

  it('does NOT call the handler for events belonging to a different job', async () => {
    const jobId = ref<string | null>('job-3')
    const handler = vi.fn()
    useComposableInVue(jobId, handler)

    await vi.waitFor(() => expect(lastSocket).not.toBeNull())
    lastSocket!.receive({ type: 'job_progress', job_id: 'OTHER-JOB', stage: 'saving', pct: 70 })

    expect(handler).not.toHaveBeenCalled()
  })

  it('sends unsubscribe_job when the component is unmounted', async () => {
    const jobId = ref<string | null>('job-4')
    const handler = vi.fn()
    const wrapper = useComposableInVue(jobId, handler)

    await vi.waitFor(() => lastSocket?.sent.some((m) => m.includes('subscribe_job')))
    wrapper.unmount()

    expect(lastSocket?.sent).toContainEqual(
      JSON.stringify({ type: 'unsubscribe_job', job_id: 'job-4' }),
    )
  })

  it('does not connect when jobId is null', () => {
    const jobId = ref<string | null>(null)
    const handler = vi.fn()
    useComposableInVue(jobId, handler)
    expect(lastSocket).toBeNull()
  })
})
