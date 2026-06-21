// kanban-column island: a collapsible board column that flags WIP overflow.
import { computed, defineComponent, signal } from '@sprig/core'
import type { Column, Issue } from '../../../../../services/board/mod.ts'

export default defineComponent({
  inputs: ['column', 'issues'],
  setup: (ctx) => {
    const column = ctx.input<Column>('column', { id: 'backlog', label: '', wip: 0 })
    const issues = ctx.input<Issue[]>('issues', [])
    const overWip = computed(() => column().wip > 0 && issues().length > column().wip)
    const collapsed = signal(false)
    const toggle = () => {
      collapsed.value = !collapsed.value
    }
    return { column, issues, overWip, collapsed, toggle }
  },
})
