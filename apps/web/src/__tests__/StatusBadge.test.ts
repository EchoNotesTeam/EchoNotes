import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import StatusBadge from '@/components/StatusBadge.vue'
import type { SheetStatus } from '@echonotes/shared-types'

const LABELS: Record<SheetStatus, string> = {
  pending: 'En espera',
  processing: 'Procesando',
  ready: 'Lista',
  failed: 'Error',
}

describe('StatusBadge', () => {
  describe('label text', () => {
    it.each(Object.entries(LABELS) as [SheetStatus, string][])(
      'renders "%s" label for status="%s"',
      (status, label) => {
        const wrapper = mount(StatusBadge, { props: { status } })
        expect(wrapper.text()).toContain(label)
      },
    )
  })

  describe('processing state UI', () => {
    it('renders the animated ping dot for status=processing', () => {
      const wrapper = mount(StatusBadge, { props: { status: 'processing' } })
      expect(wrapper.find('.animate-ping').exists()).toBe(true)
    })

    it.each<SheetStatus>(['pending', 'ready', 'failed'])(
      'does NOT render ping dot for status=%s',
      (status) => {
        const wrapper = mount(StatusBadge, { props: { status } })
        expect(wrapper.find('.animate-ping').exists()).toBe(false)
      },
    )
  })

  it('renders a <span> as the root element', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'ready' } })
    expect(wrapper.element.tagName).toBe('SPAN')
  })
})
