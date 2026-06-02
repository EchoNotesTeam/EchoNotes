import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import type { Sheet } from '@echonotes/shared-types'

// Mock vue-router's useRouter so we can assert navigation without a real router.
// `vi.hoisted` makes `push` available inside the hoisted vi.mock factory.
const { push } = vi.hoisted(() => ({ push: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push }) }))

import SheetCard from '@/components/SheetCard.vue'

function makeSheet(overrides: Partial<Sheet> = {}): Sheet {
  return {
    id: 'sheet-1',
    ownerId: 'user-1',
    title: 'Bohemian Rhapsody',
    instrument: 'piano',
    visibility: 'public',
    status: 'ready',
    transcriptionId: 'tr-1',
    audioPath: '/uploads/x.wav',
    tags: ['rock', 'classic'],
    createdAt: '2026-05-20T10:00:00.000Z',
    deletedAt: null,
    owner: { username: 'freddie', displayName: 'Freddie M.' },
    ...overrides,
  }
}

describe('SheetCard', () => {
  beforeEach(() => {
    push.mockClear()
  })

  it('renders the sheet title', () => {
    const wrapper = mount(SheetCard, { props: { sheet: makeSheet() } })
    expect(wrapper.text()).toContain('Bohemian Rhapsody')
  })

  it('renders the localized instrument label and icon', () => {
    const piano = mount(SheetCard, { props: { sheet: makeSheet({ instrument: 'piano' }) } })
    expect(piano.text()).toContain('Piano')
    expect(piano.text()).toContain('🎹')

    const guitar = mount(SheetCard, { props: { sheet: makeSheet({ instrument: 'guitar' }) } })
    expect(guitar.text()).toContain('Guitarra')
    expect(guitar.text()).toContain('🎸')
  })

  it('renders the status badge for the sheet status', () => {
    const wrapper = mount(SheetCard, { props: { sheet: makeSheet({ status: 'ready' }) } })
    // StatusBadge renders "Lista" for the ready status.
    expect(wrapper.text()).toContain('Lista')
  })

  it('renders tag chips, capped at 5', () => {
    const sheet = makeSheet({ tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] })
    const wrapper = mount(SheetCard, { props: { sheet } })
    const chips = wrapper.findAll('div.flex-wrap span')
    expect(chips).toHaveLength(5)
    expect(chips[0]!.text()).toBe('#a')
  })

  it('renders no tag section when the sheet has no tags', () => {
    const wrapper = mount(SheetCard, { props: { sheet: makeSheet({ tags: [] }) } })
    expect(wrapper.find('div.flex-wrap').exists()).toBe(false)
  })

  it('shows the owner only when showOwner is set and an owner exists', () => {
    const hidden = mount(SheetCard, { props: { sheet: makeSheet() } })
    expect(hidden.text()).not.toContain('por Freddie M.')

    const shown = mount(SheetCard, { props: { sheet: makeSheet(), showOwner: true } })
    expect(shown.text()).toContain('por Freddie M.')
  })

  it('navigates to the sheet detail route on click', async () => {
    const wrapper = mount(SheetCard, { props: { sheet: makeSheet({ id: 'abc-123' }) } })
    await wrapper.trigger('click')
    expect(push).toHaveBeenCalledWith('/sheets/abc-123')
  })

  it('navigates on Enter keydown for keyboard accessibility', async () => {
    const wrapper = mount(SheetCard, { props: { sheet: makeSheet({ id: 'abc-123' }) } })
    await wrapper.trigger('keydown.enter')
    expect(push).toHaveBeenCalledWith('/sheets/abc-123')
  })
})
