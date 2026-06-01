import { watch, onUnmounted, unref } from 'vue'
import type { Ref } from 'vue'

// ─── Event types (must match ws.ts server → client messages) ─────────────────
export type WsJobEvent =
  | { type: 'job_progress'; job_id: string; stage: string; pct: number; message?: string }
  | { type: 'job_done'; job_id: string; sheet_id: string }
  | { type: 'job_failed'; job_id: string; error_code: string; message: string }

type EventHandler = (event: WsJobEvent) => void

// ─── Singleton WS state ───────────────────────────────────────────────────────
// One WebSocket connection is shared across all active subscribers.

let socket: WebSocket | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let isConnecting = false
const subscribers = new Map<string, Set<EventHandler>>()

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${proto}//${location.host}/api/ws`
}

function connect() {
  if (socket?.readyState === WebSocket.OPEN || isConnecting) return
  isConnecting = true

  socket = new WebSocket(wsUrl())

  socket.addEventListener('open', () => {
    isConnecting = false
    // Re-subscribe jobs that were registered before the socket opened
    for (const jobId of subscribers.keys()) {
      socket!.send(JSON.stringify({ type: 'subscribe_job', job_id: jobId }))
    }
  })

  socket.addEventListener('message', (ev: MessageEvent<string>) => {
    try {
      const msg = JSON.parse(ev.data) as WsJobEvent & { type: string }
      if (
        msg.type === 'job_progress' ||
        msg.type === 'job_done' ||
        msg.type === 'job_failed'
      ) {
        subscribers.get(msg.job_id)?.forEach((fn) => fn(msg))
      }
    } catch {
      // Ignore malformed frames
    }
  })

  socket.addEventListener('close', () => {
    isConnecting = false
    socket = null
    // Reconnect automatically if there are still active subscribers
    if (subscribers.size > 0) {
      reconnectTimer = setTimeout(connect, 3000)
    }
  })

  socket.addEventListener('error', () => {
    socket?.close()
  })
}

function ensureConnected() {
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  connect()
}

function subscribe(jobId: string, handler: EventHandler) {
  if (!subscribers.has(jobId)) subscribers.set(jobId, new Set())
  subscribers.get(jobId)!.add(handler)
  ensureConnected()
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: 'subscribe_job', job_id: jobId }))
  }
}

function unsubscribe(jobId: string, handler: EventHandler) {
  const set = subscribers.get(jobId)
  if (!set) return
  set.delete(handler)
  if (set.size === 0) {
    subscribers.delete(jobId)
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'unsubscribe_job', job_id: jobId }))
    }
  }
  // Close socket when nothing left to watch
  if (subscribers.size === 0 && socket) {
    socket.close()
    socket = null
  }
}

// ─── Composable ───────────────────────────────────────────────────────────────

/**
 * Subscribe to WebSocket events for a specific job.
 *
 * @param jobId  Reactive ref or plain string. Pass `null` to disable.
 * @param onEvent  Callback invoked for every server event on that job.
 *
 * The composable automatically subscribes/unsubscribes when jobId changes,
 * and cleans up on component unmount.
 */
export function useJobSocket(
  jobId: Ref<string | null> | string | null,
  onEvent: EventHandler,
) {
  watch(
    () => unref(jobId),
    (newId, oldId) => {
      if (oldId) unsubscribe(oldId, onEvent)
      if (newId) subscribe(newId, onEvent)
    },
    { immediate: true },
  )

  onUnmounted(() => {
    const id = unref(jobId)
    if (id) unsubscribe(id, onEvent)
  })
}
