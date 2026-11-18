import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Background, Browse, BrowseEntry, CanvasMessage, CanvasProps, Mode, Stroke } from '../types'

const PANE = 'sketch'
const strokes = atom({ plugin: 'sketch-notes', key: 'strokes' } as const, [], { shape: 'strokes-1' })
const cleared = atom({ plugin: 'sketch-notes', key: 'cleared' } as const, [], { shape: 'strokes-1' })
const rev = atom({ plugin: 'sketch-notes', key: 'rev' } as const, 0)
const color = atom({ plugin: 'sketch-notes', key: 'color' } as const, '#111111')
const size = atom({ plugin: 'sketch-notes', key: 'size' } as const, 2)
const background = atom({ plugin: 'sketch-notes', key: 'background' } as const, null, { shape: 'background-1' })
const mode = atom({ plugin: 'sketch-notes', key: 'mode' } as const, 'draw' as Mode)
const browse = atom({ plugin: 'sketch-notes', key: 'browse' } as const, null, { shape: 'browse-1' })
const status = atom({ plugin: 'sketch-notes', key: 'status' } as const, '')
const sketches = atom({ plugin: 'sketch-notes', key: 'sketches' } as const, [] as string[])

type Engine = EngineInterface

const INKS: { name: string; hex: string; hotkey: string }[] = [
  { name: 'black', hex: '#111111', hotkey: '1' },
  { name: 'red', hex: '#e5484d', hotkey: '2' },
  { name: 'blue', hex: '#3e63dd', hotkey: '3' },
  { name: 'green', hex: '#30a46c', hotkey: '4' },
  { name: 'orange', hex: '#f76b15', hotkey: '5' },
  { name: 'white', hex: '#ffffff', hotkey: '6' },
  { name: 'eraser', hex: 'erase', hotkey: 'e' },
]
const SIZES = [1, 2, 4, 7]
const IMAGE = /\.(png|jpe?g|gif|heic|heif|webp|tiff?|bmp)$/i
// the canvas hands its whole picture to the drawing as props, which hold 100,000 characters:
// the grid takes 3 a pixel and the strokes the rest
const MAX_COLS = 120
const MAX_ROWS = 40
const MAX_POINTS = 6000

// the session's folder and the person's home, set at session.start
let cwd = '.'
let home = ''
// which grid size is being fetched, so a redraw does not start it twice
let gridding = ''

async function script($: Engine, args: string[], stdin?: string) {
  const argv = ['/usr/bin/env', 'ruby', `${$.plugin.root}/scripts/sketch.rb`, ...args]
  const { exitCode, stdout, stderr } = await $.process.run(argv, { timeoutMs: 60_000, stdin })
  let out: { ok?: boolean; error?: string; [k: string]: unknown } = {}
  try {
    out = JSON.parse(stdout)
  } catch {
    out = { ok: false, error: (stderr || stdout).trim().slice(0, 300) || `exit ${exitCode}` }
  }
  return out
}

function absolute(path: string): string {
  if (path === '~') return home
  if (path.startsWith('~/')) return `${home}${path.slice(1)}`
  return path.startsWith('/') ? path : `${cwd}/${path}`
}

// what a terminal pastes when a file is dropped on it: a path, quoted or with its spaces escaped,
// sometimes a file:// url, sometimes several
function droppedPath(text: string): string {
  let t = text.trim()
  if (t.startsWith('file://')) t = decodeURIComponent(t.slice(7))
  if (t[0] === '"' || t[0] === "'") {
    const end = t.indexOf(t[0], 1)
    return end > 0 ? t.slice(1, end) : t.slice(1)
  }
  let out = ''
  for (let i = 0; i < t.length; i++) {
    if (t[i] === '\\' && i + 1 < t.length) out += t[++i]
    else if (t[i] === ' ' && IMAGE.test(out)) break
    else out += t[i]
  }
  return out
}

function canvasSize(e: { props?: { bodyColumns?: number; scroll?: { bodyRows?: number } } }) {
  const cols = Math.max(20, Math.min(MAX_COLS, e.props?.bodyColumns ?? 80))
  const rows = Math.max(6, Math.min(MAX_ROWS, (e.props?.scroll?.bodyRows ?? 24) - 6))
  return { cols, rows }
}

async function regrid($: Engine, bg: Background, cols: number, rows: number) {
  const want = `${cols}x${rows * 2}`
  if (gridding === `${bg.path}@${want}`) return
  gridding = `${bg.path}@${want}`
  const out = await script($, ['--grid', bg.path, String(cols), String(rows * 2)])
  gridding = ''
  if (!out.ok) {
    await update($, status, () => `could not read the image: ${out.error}`)
    return
  }
  await update($, background, now => (now && now.path === bg.path ? { ...now, grid: String(out.grid), gridFor: want } : now))
}

async function loadImage($: Engine, raw: string): Promise<boolean> {
  const path = absolute(droppedPath(raw))
  if (!path || path === '/') {
    await update($, status, () => 'no path there')
    return false
  }
  await update($, status, () => `loading ${path}…`)
  const out = await script($, ['--check', path])
  if (!out.ok) {
    await update($, status, () => String(out.error ?? 'could not read that image'))
    return false
  }
  const name = path.split('/').pop() ?? path
  await update($, background, () => ({
    path,
    name,
    width: Number(out.width),
    height: Number(out.height),
    grid: null,
    gridFor: '',
  }))
  await update($, mode, () => 'draw' as Mode)
  await update($, status, () => `drawing over ${name} (${out.width}×${out.height})`)
  return true
}

async function openDir($: Engine, dir: string) {
  try {
    const list = await $.fs.list(dir)
    const entries: BrowseEntry[] = list
      .filter(f => !f.name.startsWith('.'))
      .filter(f => f.kind === 'dir' || f.kind === 'other' || IMAGE.test(f.name))
      .map(f => ({ name: f.name, isDir: !IMAGE.test(f.name) }))
      .sort((a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name))
    await update($, browse, () => ({ dir, entries, page: 0 }))
    await update($, mode, () => 'browse' as Mode)
  } catch (err) {
    await update($, status, () => `could not open ${dir}: ${String(err).slice(0, 200)}`)
  }
}

function parent(dir: string): string {
  const cut = dir.replace(/\/+$/, '').lastIndexOf('/')
  return cut <= 0 ? '/' : dir.slice(0, cut)
}

function pointCount(list: Stroke[]): number {
  return list.reduce((n, s) => n + s.p.length / 2, 0)
}

async function undo($: Engine) {
  const list = await read($, strokes)
  const was = await read($, cleared)
  if (list.length === 0 && was.length > 0) {
    await update($, strokes, () => was)
    await update($, cleared, () => [])
  } else {
    await update($, strokes, l => l.slice(0, -1))
  }
  await update($, rev, n => n + 1)
}

async function openPane($: Engine) {
  await update($, mode, () => 'draw' as Mode)
  await $.ui.open({ id: PANE, title: 'Sketch', focus: true, closeOnEscape: true })
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

type PinnedElement = {
  component?: string[]
  source?: string
  tag?: string
  text?: string
  selector?: string
  testid?: string
}
type PinnedNote = { n: number; where: string; text: string; on?: string; element?: PinnedElement }
// a page on the board, by its letter; path is a readable crop of it, when the overview shows it small
type BoardPage = { letter: string; url?: string; title?: string; path?: string }

function mentionOf(path: string): string {
  const shown = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
  return /\s/.test(shown) ? `@"${shown}"` : `@${shown}`
}

// where a note points: its page, then the component, its source line and the element, or a spot
function noteTarget(n: PinnedNote): string {
  const el = n.element
  const page = n.on ? `${n.on} · ` : ''
  if (!el) return n.where ? `${page}${n.where}: ` : page ? `${page.slice(0, -3)}: ` : ''
  const parts: string[] = []
  const comp = el.component && el.component.length > 0 ? el.component.join(' ‹ ') : ''
  parts.push(comp ? `<${el.component![0]}>${el.component!.length > 1 ? ` (in ${el.component!.slice(1).join(' ‹ ')})` : ''}` : '')
  parts.push(`${el.tag ?? 'element'}${el.testid ? `[data-testid="${el.testid}"]` : ''}${el.text ? ` "${el.text}"` : ''}`)
  if (el.source) parts.push(el.source)
  if (el.selector) parts.push(`selector: ${el.selector}`)
  return `${page}${parts.filter(Boolean).join(' · ')}: `
}

// puts the saved png into the prompt box as an @ mention, with what was typed, the pages and the notes
async function attachSketch($: Engine, path: string, note = '', notes: PinnedNote[] = [], pages: BoardPage[] = []): Promise<boolean> {
  const shown = path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path
  const mention = mentionOf(path)
  let text = note.trim() ? `${mention} ${note.trim()}` : mention
  if (pages.length > 0) {
    text += '\npages on the sketch:\n'
    text += pages
      .map(p => `  ${p.letter}. ${p.url ?? 'snapshot'}${p.title ? ` (${p.title})` : ''}${p.path ? ` ${mentionOf(p.path)}` : ''}`)
      .join('\n')
  }
  if (notes.length > 0) {
    text += '\nnotes pinned on the sketch (numbered on the image):\n'
    text += notes.map(n => `${n.n}. ${noteTarget(n)}${n.text.replace(/\s*\n\s*/g, ' ')}`).join('\n')
  }
  await update($, sketches, l => [...l, path].slice(-50))
  const filled = await $.prompt.fill({ text: `${text} `, mode: 'insert' })
  if (filled.isFilled === false) {
    await $.ui.copy({ text }).catch(() => undefined)
    $.ui.toast(`sketch saved to ${shown}; the prompt box was busy, so it is on your clipboard`)
    return false
  }
  $.ui.toast(`sketch attached: ${shown}`)
  return true
}

// the full-screen window: scripts/window.rb serving scripts/window.html, one at a time
let win: { url: string } | null = null
// an image pasted into the prompt box with /sketch, being saved
let pasted: Promise<string | null> | null = null

type WindowEvent = {
  ready?: boolean
  url?: string
  ok?: boolean
  path?: string
  note?: string
  notes?: PinnedNote[]
  pages?: BoardPage[]
  cancelled?: boolean
  reason?: string
}

function openWindow($: Engine, folder: string, image?: string): boolean {
  if (win) return false
  const me = { url: '' }
  win = me
  const argv = [
    '/usr/bin/env', 'ruby', `${$.plugin.root}/scripts/window.rb`,
    '--out', absolute(`${folder}/sketch-${stamp()}.png`),
    ...(image ? ['--image', image] : []),
  ]
  // the loop is the child's life: it ends when the window attaches, cancels or closes
  void (async () => {
    let buf = ''
    try {
      for await (const chunk of $.process.spawn({ argv, cwd })) {
        if (chunk.stream === 'stderr') continue
        buf += chunk.text
        let i: number
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i)
          buf = buf.slice(i + 1)
          let ev: WindowEvent
          try {
            ev = JSON.parse(line) as WindowEvent
          } catch {
            continue
          }
          if (ev.ready && ev.url) me.url = ev.url
          else if (ev.ok && ev.path) await attachSketch($, ev.path, ev.note ?? '', Array.isArray(ev.notes) ? ev.notes : [], Array.isArray(ev.pages) ? ev.pages : [])
          else if (ev.cancelled) $.ui.toast(`sketch closed: ${ev.reason ?? 'nothing attached'}`)
        }
      }
    } catch (err) {
      $.ui.toast(`the sketch window could not start: ${String(err).slice(0, 200)}`)
    } finally {
      if (win === me) win = null
    }
  })()
  return true
}

export const register: Register = (on, options) => {
  const folder = String(options.folder ?? '~/.claude/sketches').replace(/\/+$/, '') || '~/.claude/sketches'
  const opens = String(options.opens ?? 'window') === 'pane' ? 'pane' : 'window'

  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    const { stdout } = await $.process.run(['/bin/sh', '-c', 'printf %s "$HOME"']).catch(() => ({ stdout: '' }))
    home = stdout
    await $.command.register({
      name: 'sketch',
      description: 'Draw something to explain it, full screen, over a blank canvas or an image, and attach it to your prompt',
      argumentHint: '[image to draw over] [pane]',
    })
    return next(e)
  })

  on('command.run', { command: 'sketch' }, async ($, e) => {
    cwd = await $.session.cwd().catch(() => cwd) // where Claude runs now, for a relative folder setting
    let args = e.args.trim()
    let where = opens
    const flag = args.match(/(?:^|\s)(pane|window)$/)
    if (flag) {
      where = flag[1] === 'pane' ? 'pane' : 'window'
      args = args.slice(0, args.length - flag[0].length).trim()
    }

    if (where === 'pane') {
      if (args) await loadImage($, args)
      await openPane($)
      return { text: 'Sketch pane opened.' }
    }

    if (win) return { text: 'The sketch window is already open: attach or cancel it there first.' }
    // an image pasted with /sketch is saved by the prompt.submit that comes with this command
    if (!args) await $.clock.sleep(300)
    const image = args ? absolute(droppedPath(args)) : ((await (pasted ?? Promise.resolve(null)).catch(() => null)) ?? undefined)
    pasted = null
    openWindow($, folder, image)
    return { text: 'Sketch board opening full screen: click anything to say what should change, ＋ Page adds a live local server, then Attach to prompt.' }
  })

  on('prompt.submit', async ($, e, next) => {
    // an image pasted or dropped into the prompt box with /sketch becomes the picture to draw over
    if (e.command?.name === 'sketch') {
      const img = e.attachments?.find(a => a.type === 'image' && a.id)
      if (img?.id) {
        const id = img.id
        const toPane = opens === 'pane' || /(?:^|\s)pane$/.test(e.command.args.trim())
        pasted = (async () => {
          const media = await $.prompt.media({ id })
          if (!('base64' in media) || typeof media.base64 !== 'string') return null
          const ext = (img.mediaType ?? 'image/png').split('/')[1]?.replace('jpeg', 'jpg') ?? 'png'
          const out = await script($, ['--save-b64', absolute(`${folder}/pasted-${Date.now()}.${ext}`)], media.base64)
          if (!out.ok) return null
          if (toPane) await loadImage($, String(out.path))
          return String(out.path)
        })()
        await pasted.catch(() => null)
      }
      return next(e)
    }

    // a sketch named in the prompt: say what it is, so the model looks at it
    const mine = await read($, sketches)
    const named = mine.filter(p => e.text.includes(p) || e.text.includes(p.replace(`${cwd}/`, '')))
    if (named.length === 0) return next(e)
    const note =
      `the person drew ${named.length === 1 ? 'a sketch' : 'sketches'} to explain this prompt with /sketch: ` +
      `${named.join(', ')}. it is drawn by hand, on a blank white canvas or over an image they loaded; ` +
      'numbered purple pins are notes they placed on a spot, and their text is in the prompt as a numbered list. ' +
      'pages are live local servers on their board, lettered A, B, …; a note says which page it is on. ' +
      'a note with a dashed box was pinned to an element of a page: the list names its component, ' +
      'source file and line, and css selector, so go to that code. ' +
      'look at it before answering, and if it did not come through as an image, read the file.'
    return next({ ...e, context: [...(e.context ?? []), note] })
  }).catch(($, e, next) => next(e)) // a failure here never holds up the prompt: it goes on as typed

  on('ui.message', { requestId: PANE }, async ($, e) => {
    const msg = e.data as CanvasMessage
    if (msg && typeof msg === 'object' && msg.type === 'undo') {
      await undo($)
    } else if (msg && typeof msg === 'object' && msg.type === 'stroke') {
      const s = msg.stroke
      const valid =
        s && typeof s.c === 'string' && typeof s.s === 'number' && Array.isArray(s.p) &&
        s.p.every(n => Number.isInteger(n) && n >= 0 && n <= 10000)
      if (valid) {
        const list = await read($, strokes)
        if (pointCount(list) + s.p.length / 2 > MAX_POINTS) {
          await update($, status, () => 'the canvas is full: attach it, undo, or clear')
          await update($, rev, n => n + 1)
        } else {
          await update($, strokes, l => [...l, { c: s.c, s: s.s, p: s.p }])
          await update($, cleared, () => [])
        }
      }
    }
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button, Input } = els
    const Client = 'Client' in els ? els.Client : null
    const close = () => $.ui.close({ id: PANE })
    const say = (text: string) => update($, status, () => text)

    const fullScreen = async () => {
      const bgNow = await read($, background)
      if (!openWindow($, folder, bgNow?.path)) return say('the sketch window is already open')
      $.ui.toast('sketch window opening full screen')
      await close()
    }

    const header = (
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold>sketch</Text>
        <Box flexDirection="row" gap={1}>
          <Button key="full" hotkey="f" onPress={fullScreen}>⤢ full screen</Button>
          <Button key="close" role="dismiss" variant="primary" hotkey="x" onPress={close}>✕ close</Button>
        </Box>
      </Box>
    )

    if (!Client) {
      return (
        <Box flexDirection="column">
          {header}
          <Text>this surface cannot draw the canvas here: press full screen to draw in a window.</Text>
        </Box>
      )
    }

    const m = await read($, mode)
    const msg = await read($, status)
    const bg = await read($, background)
    const { cols, rows } = canvasSize(e as never)

    if (m === 'path') {
      return (
        <Box flexDirection="column">
          {header}
          <Text>drop an image file here, or type or paste its path, then press enter.</Text>
          <Input
            key="path"
            label="image "
            placeholder="/path/to/image.png"
            autoFocus
            submitLabel="load"
            onSubmit={async v => {
              await loadImage($, v)
            }}
          />
          <Box flexDirection="row" gap={1} marginTop={1}>
            <Button key="browse" hotkey="o" onPress={() => openDir($, cwd)}>browse files</Button>
            <Button key="back" hotkey="q" onPress={() => update($, mode, () => 'draw' as Mode)}>back to canvas</Button>
          </Box>
          {msg ? <Text dimColor>{msg}</Text> : null}
        </Box>
      )
    }

    if (m === 'browse') {
      const b: Browse | null = await read($, browse)
      const dir = b?.dir ?? cwd
      const room = Math.max(4, rows)
      const entries = b?.entries ?? []
      const pages = Math.max(1, Math.ceil(entries.length / room))
      const page = Math.min(b?.page ?? 0, pages - 1)
      const shown = entries.slice(page * room, page * room + room)
      const turn = (by: number) => update($, browse, now => (now ? { ...now, page: Math.min(pages - 1, Math.max(0, page + by)) } : now))
      return (
        <Box flexDirection="column">
          {header}
          <Text>
            <Text bold>{dir}</Text>
            <Text dimColor>  {entries.length} folders and images{pages > 1 ? `, page ${page + 1} of ${pages}` : ''}</Text>
          </Text>
          <Box flexDirection="row" gap={1}>
            <Button key="up" hotkey="u" onPress={() => openDir($, parent(dir))}>.. up</Button>
            <Button key="here" hotkey="h" onPress={() => openDir($, cwd)}>project</Button>
            {home ? <Button key="desk" hotkey="d" onPress={() => openDir($, `${home}/Desktop`)}>desktop</Button> : null}
            {home ? <Button key="down" hotkey="w" onPress={() => openDir($, `${home}/Downloads`)}>downloads</Button> : null}
            {pages > 1 ? <Button key="prev" hotkey="v" onPress={() => turn(-1)}>prev</Button> : null}
            {pages > 1 ? <Button key="next" hotkey="n" onPress={() => turn(1)}>next</Button> : null}
            <Button key="back" hotkey="q" onPress={() => update($, mode, () => 'draw' as Mode)}>back</Button>
          </Box>
          {shown.length === 0 ? <Text dimColor>no folders or images here</Text> : null}
          {shown.map(f => (
            <Button
              key={`f-${f.name}`}
              plain
              onPress={async () => {
                const path = dir === '/' ? `/${f.name}` : `${dir}/${f.name}`
                if (!f.isDir) {
                  await loadImage($, path)
                  return
                }
                // a link may lead to a folder or to nothing useful: open it and see
                try {
                  const s = await $.fs.stat(path)
                  if (s.kind === 'file') return say(`${f.name} is not an image`)
                } catch {
                  return say(`cannot open ${f.name}`)
                }
                await openDir($, path)
              }}
            >
              {f.isDir ? `▸ ${f.name}/` : `  ${f.name}`}
            </Button>
          ))}
          {msg ? <Text dimColor>{msg}</Text> : null}
        </Box>
      )
    }

    // draw
    const list = await read($, strokes)
    const r = await read($, rev)
    const ink = await read($, color)
    const brush = await read($, size)
    const want = `${cols}x${rows * 2}`
    if (bg && bg.gridFor !== want) void regrid($, bg, cols, rows)
    const grid = bg && bg.gridFor === want ? bg.grid : null

    const props: CanvasProps = { rev: r, cols, rows, strokes: list, color: ink, size: brush, grid }

    const attach = async () => {
      if (list.length === 0 && !bg) return say('draw something first')
      const out = await script(
        $,
        ['--export', absolute(`${folder}/sketch-${stamp()}.png`)],
        JSON.stringify({ image: bg?.path ?? null, width: cols, height: rows * 2, strokes: list }),
      )
      if (!out.ok) return say(`could not save the sketch: ${out.error}`)
      if (await attachSketch($, String(out.path))) await close()
    }

    const clear = async () => {
      if (list.length > 0) await update($, cleared, () => list)
      await update($, strokes, () => [])
      await update($, rev, n => n + 1)
      await say(list.length > 0 ? 'cleared: undo brings it back' : '')
    }

    const removeImage = async () => {
      await update($, background, () => null)
      await say('image removed')
    }

    const used = pointCount(list)

    return (
      <Box flexDirection="column">
        {header}
        <Box flexDirection="row" gap={1}>
          {INKS.map(i => (
            <Button
              key={`ink-${i.name}`}
              hotkey={i.hotkey}
              variant={ink === i.hex ? 'primary' : 'secondary'}
              onPress={() => update($, color, () => i.hex)}
            >
              {i.name}
            </Button>
          ))}
          <Button key="thin" hotkey="s" onPress={() => update($, size, s => SIZES[Math.max(0, SIZES.indexOf(s) - 1)] ?? 1)}>smaller</Button>
          <Button key="thick" hotkey="l" onPress={() => update($, size, s => SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(s) + 1)] ?? 2)}>larger</Button>
          <Text dimColor>brush {brush}</Text>
        </Box>
        <Box flexDirection="row" gap={1}>
          <Button key="attach" variant="primary" hotkey="a" onPress={attach}>attach to prompt</Button>
          <Button key="open" hotkey="o" onPress={() => openDir($, (bg?.path && parent(bg.path)) || cwd)}>open image</Button>
          <Button key="drop" hotkey="p" onPress={() => update($, mode, () => 'path' as Mode)}>drop or paste path</Button>
          {bg ? <Button key="noimg" hotkey="b" onPress={removeImage}>remove image</Button> : null}
          <Button key="undo" hotkey="u" onPress={() => undo($)}>undo</Button>
          <Button key="clear" hotkey="c" onPress={clear}>clear</Button>
        </Box>
        <Client key="canvas" module="./canvas.tsx" props={props} width={cols} height={rows} />
        <Text dimColor>
          {bg ? `over ${bg.name}${bg.gridFor === want ? '' : ' (loading…)'}  ` : ''}
          drag to draw, right-click to undo{used > MAX_POINTS * 0.8 ? `  · canvas ${Math.round((used / MAX_POINTS) * 100)}% full` : ''}
        </Text>
        {msg ? <Text dimColor>{msg}</Text> : null}
      </Box>
    )
  })
}
