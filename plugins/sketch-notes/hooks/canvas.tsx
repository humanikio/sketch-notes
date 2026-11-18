// the drawing surface inside the /sketch pane. each terminal cell is two pixels, one above the
// other, drawn as ▀ with the top pixel as its color and the bottom one as its background.
// a stroke lives here while it is drawn and is posted to the hooks module when the button comes up.
import type { ClientModule, ClientPointerEvent } from 'claude-code'

import type { CanvasProps, Stroke } from '../types'

const UNIT = 10000
const PAPER = '#ffffff'

type Local = {
  rev: number
  strokes: Stroke[]
  current: Stroke | null
  layer: string[] | null
  layerKey: string
}

function expand(grid: string | null, W: number, H: number): string[] {
  const out = new Array<string>(W * H)
  for (let i = 0; i < W * H; i++) {
    if (!grid || grid.length < (i + 1) * 3) {
      out[i] = PAPER
      continue
    }
    const r = grid[i * 3], g = grid[i * 3 + 1], b = grid[i * 3 + 2]
    out[i] = `#${r}${r}${g}${g}${b}${b}`
  }
  return out
}

function disc(px: string[], base: string[], W: number, H: number, cx: number, cy: number, r: number, color: string) {
  const rr = Math.max(r, 0.5)
  const y0 = Math.max(0, Math.floor(cy - rr))
  const y1 = Math.min(H - 1, Math.ceil(cy + rr))
  for (let y = y0; y <= y1; y++) {
    const dy = y + 0.5 - cy
    const span = rr * rr - dy * dy
    if (span < 0) continue
    const half = Math.sqrt(span)
    const x0 = Math.max(0, Math.round(cx - half))
    const x1 = Math.min(W - 1, Math.round(cx + half) - 1)
    for (let x = x0; x <= x1; x++) px[y * W + x] = color === 'erase' ? base[y * W + x]! : color
  }
  // a thin brush still leaves a mark where it lands
  if (rr <= 0.5) {
    const x = Math.min(W - 1, Math.max(0, Math.floor(cx)))
    const y = Math.min(H - 1, Math.max(0, Math.floor(cy)))
    px[y * W + x] = color === 'erase' ? base[y * W + x]! : color
  }
}

function paint(px: string[], base: string[], W: number, H: number, s: Stroke) {
  const r = Math.max(s.s, 1) / 2
  const pts: [number, number][] = []
  for (let i = 0; i + 1 < s.p.length; i += 2) pts.push([(s.p[i]! / UNIT) * W, (s.p[i + 1]! / UNIT) * H])
  if (pts.length === 0) return
  disc(px, base, W, H, pts[0]![0], pts[0]![1], r, s.c)
  const step = Math.max(r / 2, 0.5)
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1]!
    const [bx, by] = pts[i]!
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / step)
    for (let j = 1; j <= n; j++) disc(px, base, W, H, ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n, r, s.c)
  }
}

const Canvas: ClientModule<CanvasProps, Local> = (props, surface) => {
  const { Box, Text } = surface.elements
  const W = props.cols
  const H = props.rows * 2

  // the pane decides what is on the canvas after an undo, a clear or a reopen
  let local = surface.state
  if (!local || local.rev !== props.rev) {
    local = { rev: props.rev, strokes: props.strokes, current: null, layer: null, layerKey: '' }
  }

  const base = expand(props.grid, W, H)
  const key = `${W}x${H}:${local.strokes.length}:${props.grid?.length ?? 0}:${props.grid?.slice(0, 24) ?? ''}`
  if (!local.layer || local.layerKey !== key) {
    const layer = base.slice()
    for (const s of local.strokes) paint(layer, base, W, H, s)
    local = { ...local, layer, layerKey: key }
    if (surface.state !== local) surface.setState(local)
  }
  const px = local.current ? local.layer!.slice() : local.layer!
  if (local.current) paint(px, base, W, H, local.current)

  const at = (e: ClientPointerEvent): [number, number] => {
    const x = (e.fine?.x ?? e.x + 0.5) / W
    const y = (e.fine ? e.fine.y * 2 : e.y * 2 + 1) / H
    return [Math.round(Math.min(1, Math.max(0, x)) * UNIT), Math.round(Math.min(1, Math.max(0, y)) * UNIT)]
  }

  surface.onPointer(e => {
    const st = surface.state ?? local!
    if (e.type === 'down' && e.button === 'right') {
      surface.post({ type: 'undo' })
      return
    }
    if (e.type === 'down' && e.button === 'left') {
      surface.setState({ ...st, current: { c: props.color, s: props.size, p: at(e) } })
      return
    }
    if (e.type === 'move' && e.button === 'left' && st.current) {
      const [x, y] = at(e)
      const p = st.current.p
      const dx = ((x - p[p.length - 2]!) / UNIT) * W
      const dy = ((y - p[p.length - 1]!) / UNIT) * H
      if (Math.hypot(dx, dy) < 0.4) return
      surface.setState({ ...st, current: { ...st.current, p: [...p, x, y] } })
      return
    }
    if (e.type === 'up' && st.current) {
      const stroke = st.current
      surface.setState({ ...st, current: null, strokes: [...st.strokes, stroke], layer: null })
      surface.post({ type: 'stroke', stroke })
    }
  })

  surface.onKey(e => {
    if (e.key === 'u' || (e.ctrl && e.key === 'z')) surface.post({ type: 'undo' })
  })

  const lines = []
  for (let row = 0; row < props.rows; row++) {
    const runs = []
    let x = 0
    while (x < W) {
      const top = px[2 * row * W + x]
      const bottom = px[(2 * row + 1) * W + x]
      let n = 1
      while (x + n < W && px[2 * row * W + x + n] === top && px[(2 * row + 1) * W + x + n] === bottom) n++
      runs.push(
        <Text color={top} backgroundColor={bottom}>
          {'▀'.repeat(n)}
        </Text>,
      )
      x += n
    }
    lines.push(<Text>{runs}</Text>)
  }

  return (
    <Box flexDirection="column" width={W} flexShrink={0}>
      {lines}
    </Box>
  )
}

export default Canvas
