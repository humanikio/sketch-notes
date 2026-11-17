import { expect, test } from 'claude-code/testing'

const PANE = {
  plugin: 'sketch-notes-pane',
  component: 'Pane',
  requestId: 'sketch',
  props: {
    title: 'Sketch',
    isFocused: true,
    bodyColumns: 40,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

async function inked(ui: { findAll: (q: { type: 'Text'; in: string }) => Promise<{ props?: unknown }[]> }, hex: string) {
  const runs = await ui.findAll({ type: 'Text', in: 'canvas' })
  return runs.some(r => {
    const p = r.props as { color?: string; backgroundColor?: string } | undefined
    return p?.color === hex || p?.backgroundColor === hex
  })
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`a drag draws a line, red ink colors it and undo takes it away, on ${surface}`, async ($, on) => {
    on('session.start', (_, e) => ({ cwd: e.cwd }))
    on('command.register', () => ({ value: { command: 'sketch' } }))
    await $.session.start({ cwd: '/tmp', surface, isInteractive: true })

    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await inked(ui, '#111111')).toBe(false)

    await ui.pointer({ type: 'down', x: 2, y: 2, button: 'left' })
    await ui.pointer({ type: 'move', x: 10, y: 4, button: 'left' })
    await ui.pointer({ type: 'up', x: 10, y: 4, button: 'left' })
    expect(await inked(ui, '#111111')).toBe(true)

    await ui.press({ key: 'ink-red' })
    await ui.pointer({ type: 'down', x: 20, y: 6, button: 'left' })
    await ui.pointer({ type: 'up', x: 20, y: 6, button: 'left' })
    expect(await inked(ui, '#e5484d')).toBe(true)

    await ui.press({ key: 'undo' })
    expect(await inked(ui, '#e5484d')).toBe(false)
    expect(await inked(ui, '#111111')).toBe(true)

    await ui.press({ key: 'clear' })
    expect(await inked(ui, '#111111')).toBe(false)
    await ui.press({ key: 'undo' })
    expect(await inked(ui, '#111111')).toBe(true)
    await ui.unmount()
  })
}

test('a prompt that names an attached sketch tells the model to look at it', async ($, on) => {
  // what the pane recorded when it attached one
  on('state.get', (_, e) =>
    (e as { key?: string }).key === 'sketches'
      ? { value: { value: ['/tmp/.claude/sketches/sketch-1.png'], version: 1 } }
      : { value: { value: undefined, version: 0 } },
  )
  let seen: readonly string[] = []
  on('prompt.submit', (_, e) => {
    seen = e.context ?? []
    return { text: e.text }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: { command: 'sketch' } }))
  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })

  await $.prompt.submit({
    text: 'make it look like @.claude/sketches/sketch-1.png',
    wait: false,
    origin: { kind: 'composer' } as never,
  })
  expect(seen.join(' ')).toContain('sketch')
})
