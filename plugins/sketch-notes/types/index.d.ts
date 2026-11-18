// one line drawn on the canvas: c a color "#rrggbb" or "erase", s the brush width in grid
// pixels, p the points as x, y, x, y ... each 0 to 10000 across the canvas
export type Stroke = {
  c: string
  s: number
  p: number[]
}

// the image drawn over, and its pixels fitted to the canvas grid it was last drawn at
export type Background = {
  path: string
  name: string
  width: number
  height: number
  grid: string | null
  gridFor: string
}

export type BrowseEntry = {
  name: string
  isDir: boolean
}

export type Browse = {
  dir: string
  entries: BrowseEntry[]
  page: number
}

export type Mode = 'draw' | 'browse' | 'path'

// what the pane hands the canvas module (hooks/canvas.tsx)
export type CanvasProps = {
  rev: number
  cols: number
  rows: number
  strokes: Stroke[]
  color: string
  size: number
  grid: string | null
}

// what the canvas module posts back
export type CanvasMessage = { type: 'stroke'; stroke: Stroke } | { type: 'undo' }

declare module 'claude-code' {
  interface PluginState {
    'sketch-notes': {
      strokes: Shaped<Stroke[]>
      cleared: Shaped<Stroke[]>
      rev: number
      color: string
      size: number
      background: Shaped<Background | null>
      mode: Mode
      browse: Shaped<Browse | null>
      status: string
      sketches: string[]
    }
  }
}
