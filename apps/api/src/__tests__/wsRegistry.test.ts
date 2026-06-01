import { describe, it, expect, vi, beforeEach } from 'vitest'
import { WsRegistry } from '../services/wsRegistry.js'
import type { WebSocket } from 'ws'

// Minimal WebSocket mock — only the fields the registry uses.
function makeMockWs(readyState = 1 /* WebSocket.OPEN */): WebSocket {
  return {
    readyState,
    send: vi.fn(),
  } as unknown as WebSocket
}

describe('WsRegistry', () => {
  let onFirst: ReturnType<typeof vi.fn>
  let onLast: ReturnType<typeof vi.fn>
  let registry: WsRegistry

  beforeEach(() => {
    onFirst = vi.fn()
    onLast = vi.fn()
    registry = new WsRegistry(onFirst, onLast)
  })

  // ─── subscribe ─────────────────────────────────────────────────────────────

  it('calls onFirstSubscribe when the first client subscribes to a job', () => {
    registry.subscribe('job-1', makeMockWs())
    expect(onFirst).toHaveBeenCalledOnce()
    expect(onFirst).toHaveBeenCalledWith('job-1')
  })

  it('does NOT call onFirstSubscribe for the second client on the same job', () => {
    registry.subscribe('job-1', makeMockWs())
    registry.subscribe('job-1', makeMockWs())
    expect(onFirst).toHaveBeenCalledOnce()
  })

  it('calls onFirstSubscribe once per distinct job', () => {
    registry.subscribe('job-A', makeMockWs())
    registry.subscribe('job-B', makeMockWs())
    expect(onFirst).toHaveBeenCalledTimes(2)
    expect(onFirst).toHaveBeenCalledWith('job-A')
    expect(onFirst).toHaveBeenCalledWith('job-B')
  })

  // ─── unsubscribe ───────────────────────────────────────────────────────────

  it('calls onLastUnsubscribe when the last client unsubscribes', () => {
    const ws = makeMockWs()
    registry.subscribe('job-1', ws)
    registry.unsubscribe('job-1', ws)
    expect(onLast).toHaveBeenCalledOnce()
    expect(onLast).toHaveBeenCalledWith('job-1')
  })

  it('does NOT call onLastUnsubscribe while other clients are still subscribed', () => {
    const ws1 = makeMockWs()
    const ws2 = makeMockWs()
    registry.subscribe('job-1', ws1)
    registry.subscribe('job-1', ws2)
    registry.unsubscribe('job-1', ws1)
    expect(onLast).not.toHaveBeenCalled()
  })

  it('calling unsubscribe on an unknown job is a no-op', () => {
    expect(() => registry.unsubscribe('nonexistent', makeMockWs())).not.toThrow()
    expect(onLast).not.toHaveBeenCalled()
  })

  // ─── broadcast ────────────────────────────────────────────────────────────

  it('sends JSON to all OPEN clients for a job', () => {
    const ws1 = makeMockWs()
    const ws2 = makeMockWs()
    registry.subscribe('job-2', ws1)
    registry.subscribe('job-2', ws2)

    registry.broadcast('job-2', { type: 'job_progress', pct: 42 })

    const expected = JSON.stringify({ type: 'job_progress', pct: 42 })
    expect(ws1.send).toHaveBeenCalledWith(expected)
    expect(ws2.send).toHaveBeenCalledWith(expected)
  })

  it('skips CLOSED clients during broadcast', () => {
    const open = makeMockWs(1 /* OPEN */)
    const closed = makeMockWs(3 /* CLOSED */)
    registry.subscribe('job-3', open)
    registry.subscribe('job-3', closed)

    registry.broadcast('job-3', { type: 'job_done' })

    expect(open.send).toHaveBeenCalledOnce()
    expect(closed.send).not.toHaveBeenCalled()
  })

  it('broadcast to an unknown job is a no-op', () => {
    expect(() => registry.broadcast('ghost-job', { type: 'ping' })).not.toThrow()
  })

  // ─── unsubscribeAll ───────────────────────────────────────────────────────

  it('unsubscribeAll removes a client from every job it was subscribed to', () => {
    const ws = makeMockWs()
    registry.subscribe('job-A', ws)
    registry.subscribe('job-B', ws)

    registry.unsubscribeAll(ws)

    // Both jobs should have triggered onLastUnsubscribe
    expect(onLast).toHaveBeenCalledTimes(2)

    // Broadcasting to those jobs should reach nobody
    const spy = vi.fn()
    registry.subscribe('job-A', { readyState: 1, send: spy } as unknown as WebSocket)
    registry.broadcast('job-A', { type: 'test' })
    // spy was just added, so this IS called — we verify the previous ws is gone by
    // checking that the old ws.send was never called after unsubscribeAll.
    expect(ws.send).not.toHaveBeenCalled()
  })
})
