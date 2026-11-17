// sketch notes: the board. an infinite canvas of objects (strokes, shapes, images, live pages, notes)
// that you comment on, select, move, copy, paste and delete, then attach to your prompt as a png.
//
// a plain click asks "What should be changed here?". drawing only happens with a drawing tool picked.
'use strict'

const T = window.SKETCH.token
const HAS_IMAGE = window.SKETCH.hasImage
const $ = id => document.getElementById(id)
const api = (path, opt) => fetch(`${path}${path.includes('?') ? '&' : '?'}t=${T}`, opt)
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
const uid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
const frames = (n = 2) => new Promise(r => { const f = k => (k ? requestAnimationFrame(() => f(k - 1)) : r()); f(n) })

const COLORS = ['#e5484d', '#111111', '#3e63dd', '#30a46c', '#f76b15', '#ffffff']
const NOTE = '#6e56cf'
const TITLE = 36 // a page's title bar, in board px
const SIZES = { desktop: [1440, 900], laptop: [1280, 800], tablet: [834, 1112], mobile: [390, 844] }
const DRAWN = new Set(['pen', 'hl', 'arrow', 'box'])

// ---------- state ----------
let objects = [] // z order, notes anywhere (always drawn on top)
const bitmaps = new Map() // image src -> ImageBitmap
const blobs = new Map() // image src -> Blob, until saved
let selected = new Set()
let tool = 'select'
let style = { color: COLORS[0], width: 4, opacity: 1 }
let view = { x: -60, y: -60, z: 1 }
let current = null // the drawing being drawn
let drag = null // what the pointer is doing
let editing = null, editorEl = null
let undoStack = [], redoStack = []
let live = false // the board runs in the inspect profile: live pages can be read
let recent = [] // urls added before
let finished = false
let clipboard = null
let spaceDown = false
let hoverEl = null

const stage = $('stage'), hit = $('hit'), pagesEl = $('pages'), pinsEl = $('pins')
const back = $('back'), front = $('front')
const bctx = back.getContext('2d'), fctx = front.getContext('2d')

// ---------- coordinates ----------
function stageRect() { return stage.getBoundingClientRect() }
function toBoard(cx, cy) { const r = stageRect(); return [(cx - r.left) / view.z + view.x, (cy - r.top) / view.z + view.y] }
function toScreen(bx, by) { return [(bx - view.x) * view.z, (by - view.y) * view.z] }
function byId(id) { return objects.find(o => o.id === id) }
function notes() { return objects.filter(o => o.kind === 'note') }
function noteNumber(n) { return notes().indexOf(n) + 1 }

// a note's place: free on the board, on a spot of an image, or on a page (a spot or a component)
function parentOf(n) { return n.on ? byId(n.on) : null }
function domFrame(p) {
  if (p.kind === 'page') return { x: p.x, y: p.y + TITLE, k: 1 }
  return { x: p.x, y: p.y, k: p.dom ? p.w / p.dom.vw : 1 }
}
function notePos(n) {
  const p = parentOf(n)
  if (!p) return { x: n.x, y: n.y }
  if (n.el) { const f = domFrame(p); return { x: f.x + n.el.x * f.k, y: f.y + n.el.y * f.k } }
  if (p.kind === 'image') return { x: p.x + n.u * p.w, y: p.y + n.v * p.h }
  return { x: p.x + n.px, y: p.y + TITLE + n.py }
}
function noteBox(n) {
  const p = parentOf(n)
  if (!p || !n.el) return null
  const f = domFrame(p)
  return { x: f.x + n.el.x * f.k, y: f.y + n.el.y * f.k, w: n.el.w * f.k, h: n.el.h * f.k }
}

function bounds(o) {
  if (o.kind === 'pen' || o.kind === 'hl') {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [x, y] of o.pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y) }
    const pad = (o.kind === 'hl' ? o.width * 3.5 : o.width) / 2
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 }
  }
  if (o.kind === 'arrow' || o.kind === 'box') {
    const pad = o.kind === 'arrow' ? Math.max(o.width * 4, 12) : o.width / 2
    const x0 = Math.min(o.a[0], o.b[0]), y0 = Math.min(o.a[1], o.b[1])
    return { x: x0 - pad, y: y0 - pad, w: Math.abs(o.b[0] - o.a[0]) + pad * 2, h: Math.abs(o.b[1] - o.a[1]) + pad * 2 }
  }
  if (o.kind === 'image') return { x: o.x, y: o.y, w: o.w, h: o.h }
  if (o.kind === 'page') return { x: o.x, y: o.y, w: o.w, h: o.h + TITLE }
  if (o.kind === 'note') { const p = notePos(o); const r = 13 / view.z; return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 } }
  return { x: 0, y: 0, w: 0, h: 0 }
}
function union(list) {
  if (!list.length) return null
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const b of list) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h) }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
}
const touches = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
const inside = (x, y, b) => x >= b.x && y >= b.y && x <= b.x + b.w && y <= b.y + b.h

function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  const t = dx || dy ? clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
function nearDrawing(o, x, y, extra) {
  if (o.kind === 'pen' || o.kind === 'hl') {
    const r = (o.kind === 'hl' ? o.width * 1.75 : o.width / 2) + extra
    if (o.pts.length === 1) return Math.hypot(x - o.pts[0][0], y - o.pts[0][1]) <= r
    for (let i = 1; i < o.pts.length; i++) if (distSeg(x, y, ...o.pts[i - 1], ...o.pts[i]) <= r) return true
    return false
  }
  if (o.kind === 'arrow') return distSeg(x, y, ...o.a, ...o.b) <= o.width / 2 + extra
  if (o.kind === 'box') {
    const [ax, ay] = o.a, [bx, by] = o.b, r = o.width / 2 + extra
    return [[ax, ay, bx, ay], [bx, ay, bx, by], [bx, by, ax, by], [ax, by, ax, ay]].some(s => distSeg(x, y, ...s) <= r)
  }
  return false
}
// the top object under a board point: drawings first (they sit above), then images and pages
function hitObject(x, y) {
  const tol = 5 / view.z
  for (let i = objects.length - 1; i >= 0; i--) if (DRAWN.has(objects[i].kind) && nearDrawing(objects[i], x, y, tol)) return objects[i]
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]
    if ((o.kind === 'page' || o.kind === 'image') && inside(x, y, bounds(o))) return o
  }
  return null
}

// ---------- undo ----------
function replacer(key, val) {
  if (key.startsWith('_')) return undefined
  if (key === 'dom' && this && this.kind === 'page') return undefined
  return val
}
const snap = () => JSON.stringify(objects, replacer)
function restore(json) {
  const keep = new Map(objects.filter(o => o.kind === 'page').map(o => [o.id, o]))
  objects = JSON.parse(json).map(o => (o.kind === 'page' && keep.has(o.id) ? Object.assign(keep.get(o.id), o) : o))
  selected = new Set([...selected].filter(id => byId(id)))
  closeEditor(false, true)
  changed()
}
function pushUndo() {
  undoStack.push(snap())
  if (undoStack.length > 200) undoStack.shift()
  redoStack = []
}
function change(fn) { pushUndo(); fn(); changed() }
function undo() { if (undoStack.length) { redoStack.push(snap()); restore(undoStack.pop()) } }
function redo() { if (redoStack.length) { undoStack.push(snap()); restore(redoStack.pop()) } }

// ---------- saving the board ----------
let saveTimer = null
function changed() { schedule(); clearTimeout(saveTimer); saveTimer = setTimeout(save, 1000) }
async function save() {
  if (finished) return
  const board = { version: 2, view, style, recent, objects: JSON.parse(snap()) }
  await api('/board', { method: 'PUT', body: JSON.stringify(board) }).catch(() => {})
}
async function saveImage(src) {
  const blob = blobs.get(src)
  if (!blob) return
  const res = await api(`/board/image?id=${src}`, { method: 'PUT', body: blob }).catch(() => null)
  if (res && res.ok) blobs.delete(src)
}
async function loadBoard() {
  const data = await api('/board').then(r => r.json()).catch(() => null)
  const b = data && data.board
  if (!b || !Array.isArray(b.objects)) return
  objects = b.objects
  if (b.view) view = b.view
  if (b.style) style = { ...style, ...b.style }
  if (Array.isArray(b.recent)) recent = b.recent
  await Promise.all(objects.filter(o => o.kind === 'image').map(async o => {
    const res = await api(`/board/image?id=${o.src}`).catch(() => null)
    if (res && res.ok) bitmaps.set(o.src, await createImageBitmap(await res.blob()).catch(() => null))
  }))
}

// ---------- drawing ----------
function strokePath(ctx, pts) {
  ctx.beginPath()
  ctx.moveTo(pts[0][0], pts[0][1])
  if (pts.length === 1) { ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); ctx.stroke(); return }
  for (let i = 1; i < pts.length - 1; i++) {
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], (pts[i][0] + pts[i + 1][0]) / 2, (pts[i][1] + pts[i + 1][1]) / 2)
  }
  const last = pts[pts.length - 1]
  ctx.lineTo(last[0], last[1])
  ctx.stroke()
}
function drawShape(ctx, o) {
  ctx.save()
  ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  ctx.strokeStyle = o.color; ctx.fillStyle = o.color
  ctx.globalAlpha = o.opacity ?? 1
  if (o.kind === 'pen') {
    if (o.pressure && o.pts.length > 1) {
      for (let i = 1; i < o.pts.length; i++) {
        const [ax, ay, ap] = o.pts[i - 1], [bx, by, bp] = o.pts[i]
        ctx.lineWidth = o.width * (0.35 + (((ap ?? 0.5) + (bp ?? 0.5)) / 2) * 1.1)
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
      }
    } else { ctx.lineWidth = o.width; strokePath(ctx, o.pts) }
  } else if (o.kind === 'hl') {
    ctx.globalAlpha = 0.35 * (o.opacity ?? 1); ctx.lineCap = 'square'; ctx.lineWidth = o.width * 3.5
    strokePath(ctx, o.pts)
  } else if (o.kind === 'arrow') {
    const [ax, ay] = o.a, [bx, by] = o.b
    const ang = Math.atan2(by - ay, bx - ax), head = Math.max(o.width * 4, 12)
    ctx.lineWidth = o.width
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(bx, by); ctx.lineTo(bx - head * Math.cos(ang - 0.45), by - head * Math.sin(ang - 0.45))
    ctx.moveTo(bx, by); ctx.lineTo(bx - head * Math.cos(ang + 0.45), by - head * Math.sin(ang + 0.45))
    ctx.stroke()
  } else if (o.kind === 'box') {
    ctx.lineWidth = o.width
    const x = Math.min(o.a[0], o.b[0]), y = Math.min(o.a[1], o.b[1])
    const w = Math.abs(o.b[0] - o.a[0]), h = Math.abs(o.b[1] - o.a[1])
    ctx.beginPath()
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, Math.min(o.width * 1.5, w / 2, h / 2)); else ctx.rect(x, y, w, h)
    ctx.stroke()
  }
  ctx.restore()
}

let queued = false
function schedule() { if (!queued) { queued = true; requestAnimationFrame(render) } }
function sizeCanvas(c) {
  const dpr = window.devicePixelRatio || 1, r = stageRect()
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr)
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h }
  return dpr
}
function render() {
  queued = false
  const dpr = sizeCanvas(back); sizeCanvas(front)
  const r = stageRect(), z = view.z
  // back: the dot grid and the images
  bctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  bctx.clearRect(0, 0, r.width, r.height)
  let step = 24
  while (step * z < 12) step *= 2
  bctx.fillStyle = '#d4d4da'
  const gx0 = Math.floor(view.x / step) * step, gy0 = Math.floor(view.y / step) * step
  for (let gx = gx0; gx < view.x + r.width / z; gx += step) {
    for (let gy = gy0; gy < view.y + r.height / z; gy += step) {
      const [sx, sy] = toScreen(gx, gy)
      bctx.fillRect(sx - 0.75, sy - 0.75, 1.5, 1.5)
    }
  }
  bctx.setTransform(dpr * z, 0, 0, dpr * z, -view.x * z * dpr, -view.y * z * dpr)
  bctx.imageSmoothingQuality = 'high'
  for (const o of objects) {
    if (o.kind !== 'image') continue
    bctx.save()
    bctx.shadowColor = 'rgba(0,0,0,.18)'; bctx.shadowBlur = 16 / z; bctx.shadowOffsetY = 3 / z
    bctx.fillStyle = '#fff'; bctx.fillRect(o.x, o.y, o.w, o.h)
    bctx.restore()
    const bmp = bitmaps.get(o.src)
    if (bmp) bctx.drawImage(bmp, o.x, o.y, o.w, o.h)
    else { bctx.fillStyle = '#e4e4ea'; bctx.fillRect(o.x, o.y, o.w, o.h) }
    if (selected.has(o.id)) { bctx.strokeStyle = '#0ea5e9'; bctx.lineWidth = 2 / z; bctx.strokeRect(o.x, o.y, o.w, o.h) }
  }
  // pages: the dom layer, moved with the view
  pagesEl.style.transform = `translate(${-view.x * z}px, ${-view.y * z}px) scale(${z})`
  syncPages()
  // front: the drawings
  fctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  fctx.clearRect(0, 0, r.width, r.height)
  fctx.setTransform(dpr * z, 0, 0, dpr * z, -view.x * z * dpr, -view.y * z * dpr)
  for (const o of objects) if (DRAWN.has(o.kind)) drawShape(fctx, o)
  if (current) drawShape(fctx, current)
  for (const o of objects) {
    if (!DRAWN.has(o.kind) || !selected.has(o.id)) continue
    const b = bounds(o)
    fctx.save(); fctx.setLineDash([4 / z, 3 / z]); fctx.strokeStyle = '#0ea5e9'; fctx.lineWidth = 1.2 / z
    fctx.strokeRect(b.x, b.y, b.w, b.h); fctx.restore()
  }
  renderOverlay()
  $('hint').style.display = objects.length || current ? 'none' : ''
  $('zoom').textContent = `${Math.round(z * 100)}% ▾`
  $('undo').disabled = !undoStack.length
  $('redo').disabled = !redoStack.length
  $('propsfor').textContent = selectedDrawings().length ? `${selectedDrawings().length} selected` : 'next drawing'
}

// ---------- pages: live local servers on the board ----------
function pageLetters() {
  const list = objects.filter(o => o.kind === 'page' || (o.kind === 'image' && o.page))
  return new Map(list.sort((a, b) => a.y - b.y || a.x - b.x).map((o, i) => [o.id, String.fromCharCode(65 + (i % 26))]))
}
function syncPages() {
  const letters = pageLetters()
  const keep = new Set()
  for (const p of objects) {
    if (p.kind !== 'page') continue
    keep.add(p.id)
    let el = pagesEl.querySelector(`[data-id="${p.id}"]`)
    if (!el) el = makePage(p)
    el.style.left = `${p.x}px`; el.style.top = `${p.y}px`; el.style.width = `${p.w}px`
    el.querySelector('iframe').style.height = `${p.h}px`
    el.classList.toggle('interact', p.mode === 'interact')
    el.classList.toggle('selected', selected.has(p.id))
    el.querySelector('.letter').textContent = letters.get(p.id) || ''
    el.querySelector('.url').textContent = p.title ? `${p.title} · ${p.url}` : p.url
    el.querySelector('.url').title = p.url
    el.querySelectorAll('.modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === (p.mode || 'comment')))
    const dot = el.querySelector('.dot')
    dot.className = `dot ${p._status || ''}`
    dot.title = { live: 'live: components can be read', blocked: 'this page did not answer as a frame', '': 'loading' }[p._status || ''] || ''
    el.querySelector('.snap').hidden = p._status !== 'blocked'
    const size = el.querySelector('.size')
    if (size.value !== sizeName(p)) size.value = sizeName(p)
  }
  pagesEl.querySelectorAll('.page').forEach(el => { if (!keep.has(el.dataset.id)) el.remove() })
}
function sizeName(p) {
  const hit = Object.entries(SIZES).find(([, [w, h]]) => w === p.w && h === p.h)
  return hit ? hit[0] : 'custom'
}
function makePage(p) {
  const el = document.createElement('div')
  el.className = 'page'
  el.dataset.id = p.id
  el.innerHTML = `<div class="bar">
      <span class="dot"></span><span class="letter"></span><span class="url"></span>
      <button class="reload" title="Reload">⟳</button>
      <span class="modes"><button data-mode="comment" title="Click to comment on components">Comment</button><button data-mode="interact" title="Use the page: clicks and typing go to it">Interact</button></span>
      <select class="size" title="Page size">${Object.entries(SIZES).map(([k, [w, h]]) => `<option value="${k}">${k} ${w}×${h}</option>`).join('')}<option value="custom">custom</option></select>
      <button class="snap" hidden title="This page refuses to be framed: put a snapshot of it on the board instead">Use snapshot</button>
    </div><iframe name="sketch-page-${p.id}" allow="clipboard-read; clipboard-write"></iframe>`
  const frame = el.querySelector('iframe')
  frame.src = p.url
  frame.addEventListener('load', () => {
    const q = byId(p.id)
    if (!q) return
    q._fails = 0
    setTimeout(() => ensureDom(q, true), 400)
  })
  const bar = el.querySelector('.bar')
  bar.addEventListener('pointerdown', e => {
    if (e.target.closest('button, select')) return
    e.preventDefault()
    const q = byId(p.id)
    if (!q) return
    if (!selected.has(q.id) && !e.shiftKey) selected = new Set([q.id])
    else if (e.shiftKey) selected.add(q.id)
    startMove(e)
  })
  bar.querySelector('.reload').onclick = () => { const q = byId(p.id); if (q) { q._status = ''; frame.src = q.url; schedule() } }
  bar.querySelectorAll('.modes button').forEach(b => (b.onclick = () => {
    const q = byId(p.id)
    if (!q) return
    change(() => { q.mode = b.dataset.mode })
    if (q.mode === 'comment') ensureDom(q, true)
    status(q.mode === 'interact' ? 'Interact: use the page, then switch back to Comment to pin notes' : '')
  }))
  bar.querySelector('.size').onchange = e => {
    const q = byId(p.id)
    const s = SIZES[e.target.value]
    if (q && s) change(() => { q.w = s[0]; q.h = s[1] })
  }
  bar.querySelector('.snap').onclick = () => { const q = byId(p.id); if (q) useSnapshot(q) }
  pagesEl.appendChild(el)
  return el
}
// where something new of w×h goes: the middle of the view when that is clear, else beside
// everything already on the board, so nothing lands on top of a page or a picture
function freeSpot(w, h) {
  const r = stageRect()
  const [cx, cy] = toBoard(r.left + r.width / 2, r.top + r.height / 2)
  const spot = { x: cx - w / 2, y: cy - h / 2, w, h }
  const solid = objects.filter(o => o.kind === 'page' || o.kind === 'image').map(bounds)
  if (!solid.some(b => touches(b, spot))) return [spot.x, spot.y]
  const all = union(solid)
  return [all.x + all.w + 80, all.y]
}
function normalizeUrl(raw) {
  let u = String(raw || '').trim()
  if (!u) return ''
  if (/^\d+$/.test(u)) u = `localhost:${u}`
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`
  try {
    const url = new URL(u)
    // a page on 127.0.0.1 would share this board's site and could not be read as its own frame
    if (url.hostname === '127.0.0.1') url.hostname = 'localhost'
    return url.toString()
  } catch { return '' }
}
// a url already on the board: show that page first; adding it again within 8s puts a second copy
let lastDup = { url: '', at: 0 }
function addPage(rawUrl, sizeKey = 'desktop') {
  const url = normalizeUrl(rawUrl)
  if (!url) return status('that is not a url')
  const same = objects.find(o => o.kind === 'page' && o.url === url)
  if (same && !(lastDup.url === url && Date.now() - lastDup.at < 8000)) {
    lastDup = { url, at: Date.now() }
    selected = new Set([same.id])
    zoomTo(bounds(same), 0.85)
    return status(`${url} is already on the board as page ${pageLetters().get(same.id)}: add it again to put a second copy`)
  }
  lastDup = { url: '', at: 0 }
  const [w, h] = SIZES[sizeKey] || SIZES.desktop
  const [x, y] = freeSpot(w, h + TITLE)
  const p = { id: uid(), kind: 'page', url, title: '', x, y, w, h, mode: 'comment' }
  change(() => objects.push(p))
  selected = new Set([p.id])
  recent = [url, ...recent.filter(u => u !== url)].slice(0, 8)
  zoomTo(bounds(p), 0.85)
}
// reads a live page's elements and components, at most every 1.5s
function ensureDom(p, force) {
  if (!live || p.kind !== 'page' || p.mode === 'interact') return null
  if (p._loading) return p._loading
  if (!force && p.dom && Date.now() - p.dom.at < 1500) return null
  p._loading = api(`/pages/inspect?name=${p.id}`).then(r => r.json()).then(d => {
    // chrome's own error page in the frame (refused to frame, refused to connect): not the site
    if (d.ok && /^chrome-error:/.test(d.url || '')) {
      p._status = 'blocked'
      p.dom = null
    } else if (d.ok) {
      p.dom = { ...d, at: Date.now() }
      p._status = 'live'
      p._fails = 0
      if (d.url && /^https?:/.test(d.url)) p.url = d.url
      p.title = d.title || ''
    } else {
      p._fails = (p._fails || 0) + 1
      if (p._fails >= 3) p._status = 'blocked'
      else setTimeout(() => ensureDom(p, true), 1200)
    }
  }).catch(() => {}).finally(() => { p._loading = null; schedule() })
  return p._loading
}
// a page that will not be framed: put a snapshot of it in its place, its components kept
async function useSnapshot(p) {
  status(`snapshotting ${p.url}…`)
  const d = await api(`/pages/fallback?url=${encodeURIComponent(p.url)}`, { method: 'POST' }).then(r => r.json()).catch(e => ({ ok: false, error: String(e) }))
  if (!d.ok) return status(`could not snapshot: ${d.error}`)
  const blob = await (await fetch(`data:image/png;base64,${d.png}`)).blob()
  const bmp = await createImageBitmap(blob)
  const src = uid()
  bitmaps.set(src, bmp); blobs.set(src, blob); saveImage(src)
  const img = { id: uid(), kind: 'image', src, name: d.title || p.url, x: p.x, y: p.y + TITLE, w: p.w, h: p.w * (bmp.height / bmp.width),
    dom: { vw: d.vw, vh: d.vh, elements: d.elements, url: d.url, title: d.title, at: Date.now() }, page: { url: d.url || p.url, title: d.title || '' } }
  change(() => {
    const i = objects.indexOf(p)
    objects.splice(i, 1, img)
    for (const n of notes()) if (n.on === p.id) {
      n.on = img.id
      if (!n.el) { n.u = clamp(n.px / img.w, 0, 1); n.v = clamp(n.py / img.h, 0, 1); delete n.px; delete n.py }
    }
  })
  selected = new Set([img.id])
  status('snapshot placed: click a component to note it')
}

// the smallest element under a board point, on a page or a snapshot that has them
function domAt(o, x, y) {
  if (!o || !o.dom || !o.dom.elements) return null
  const f = domFrame(o)
  const px = (x - f.x) / f.k, py = (y - f.y) / f.k
  let best = null, area = Infinity
  for (const el of o.dom.elements) {
    if (px < el.x || py < el.y || px > el.x + el.w || py > el.y + el.h) continue
    const a = el.w * el.h
    if (a <= area) { area = a; best = el }
  }
  return best
}
function elName(el) {
  const comp = el.comp && el.comp[0]
  return (comp ? `${comp} › ${el.tag}` : el.tag) + (el.testid ? `[${el.testid}]` : '')
}
function ancestors(o, el) {
  const out = []
  for (let p = el.p; p >= 0 && out.length < 5; p = o.dom.elements[p].p) out.push(o.dom.elements[p])
  return out
}

// ---------- the overlay: pins, outlines, selection ----------
function renderOverlay() {
  const z = view.z
  // pins and component outlines
  const keep = new Set()
  notes().forEach((n, i) => {
    keep.add(n.id)
    let el = pinsEl.querySelector(`[data-id="${n.id}"]`)
    if (!el) {
      el = document.createElement('div')
      el.className = 'pin'
      el.dataset.id = n.id
      el.innerHTML = '<div class="dot"></div><div class="label"></div>'
      el.addEventListener('pointerdown', e => {
        e.stopPropagation(); e.preventDefault()
        const q = byId(n.id)
        if (!q) return
        if (e.shiftKey) { selected.has(q.id) ? selected.delete(q.id) : selected.add(q.id); schedule(); return }
        openEditor(q)
      })
      pinsEl.appendChild(el)
    }
    const p = notePos(n)
    const [sx, sy] = toScreen(p.x, p.y)
    el.style.left = `${sx}px`; el.style.top = `${sy}px`
    el.classList.toggle('pending', n === editing)
    el.classList.toggle('selected', selected.has(n.id))
    el.classList.toggle('left', sx > stage.clientWidth - 280)
    el.querySelector('.dot').textContent = String(i + 1)
    const label = el.querySelector('.label')
    label.textContent = n.text
    label.style.display = n.text && n !== editing ? '' : 'none'
    let box = pinsEl.querySelector(`[data-box="${n.id}"]`)
    const b = noteBox(n)
    if (b) {
      if (!box) { box = document.createElement('div'); box.className = 'elbox'; box.dataset.box = n.id; pinsEl.prepend(box) }
      const [bx, by] = toScreen(b.x, b.y)
      Object.assign(box.style, { left: `${bx}px`, top: `${by}px`, width: `${b.w * z}px`, height: `${b.h * z}px` })
      box.classList.toggle('editing', n === editing)
    } else if (box) box.remove()
  })
  pinsEl.querySelectorAll('.pin').forEach(el => { if (!keep.has(el.dataset.id)) el.remove() })
  pinsEl.querySelectorAll('.elbox').forEach(el => { if (!keep.has(el.dataset.box)) el.remove() })
  if (editorEl && editing) placeEditor()

  // the marquee
  const mq = $('marq')
  if (drag && drag.mode === 'marquee') {
    const b = rectOf(drag.bx, drag.by, drag.cx, drag.cy)
    const [x, y] = toScreen(b.x, b.y)
    Object.assign(mq.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${b.w * z}px`, height: `${b.h * z}px` })
  } else mq.style.display = 'none'

  // the selection: its box, handles and toolbar
  const sb = $('selbox'), st = $('seltools')
  const sel = selectionBounds()
  if (sel && !(drag && drag.mode === 'marquee') && !current) {
    const [x, y] = toScreen(sel.x, sel.y)
    Object.assign(sb.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${sel.w * z}px`, height: `${sel.h * z}px` })
    const onlyNotes = [...selected].every(id => byId(id)?.kind === 'note')
    sb.querySelectorAll('.h').forEach(h => (h.style.display = onlyNotes ? 'none' : ''))
    if (!drag) {
      st.style.display = 'flex'
      const top = y > 52 ? y - 10 : y + sel.h * z + 46
      st.style.left = `${clamp(x + (sel.w * z) / 2, 120, stage.clientWidth - 120)}px`
      st.style.top = `${top}px`
    } else st.style.display = 'none'
  } else { sb.style.display = 'none'; st.style.display = 'none' }

  // the component under the mouse
  const hl = $('hl')
  if (hoverEl && !drag && !editing && tool === 'select') {
    const { o, el } = hoverEl
    const f = domFrame(o)
    const [x, y] = toScreen(f.x + el.x * f.k, f.y + el.y * f.k)
    Object.assign(hl.style, { display: 'block', left: `${x}px`, top: `${y}px`, width: `${el.w * f.k * z}px`, height: `${el.h * f.k * z}px` })
    hl.classList.toggle('below', y < 26)
    hl.querySelector('.tag').innerHTML = `${esc(elName(el))} <i>${el.w}×${el.h}${el.src ? ` · ${esc(el.src.split('/').slice(-2).join('/'))}` : ''}</i>`
  } else hl.style.display = 'none'
}
function rectOf(ax, ay, bx, by) { return { x: Math.min(ax, bx), y: Math.min(ay, by), w: Math.abs(bx - ax), h: Math.abs(by - ay) } }
function selectionBounds() { return union([...selected].map(byId).filter(Boolean).map(bounds)) }
function selectedDrawings() { return [...selected].map(byId).filter(o => o && DRAWN.has(o.kind)) }

// ---------- pointer: the board ----------
hit.addEventListener('contextmenu', e => e.preventDefault())
hit.addEventListener('pointerdown', e => {
  if (finished) return
  if (e.button === 1 || (e.button === 0 && spaceDown)) return startPan(e)
  if (e.button !== 0) return
  hit.setPointerCapture(e.pointerId)
  const [bx, by] = toBoard(e.clientX, e.clientY)
  if (tool === 'select') {
    closeEditor(true)
    // ⌘-click on a page clicks the page itself: links, buttons, menus
    const page = e.metaKey && live && pageBodyAt(bx, by)
    if (page) { sendInput(page, [{ type: 'click', x: e.clientX, y: e.clientY }]); return }
    drag = { mode: 'press', sx: e.clientX, sy: e.clientY, bx, by, cx: bx, cy: by, o: hitObject(bx, by), shift: e.shiftKey, alt: e.altKey }
    return
  }
  closeEditor(true)
  if (selected.size) { selected = new Set(); schedule() }
  if (tool === 'erase') { drag = { mode: 'erase', pushed: false }; eraseAt(bx, by); return }
  const width = style.width / view.z
  if (tool === 'arrow' || tool === 'box') current = { id: uid(), kind: tool, color: style.color, width, opacity: style.opacity, a: [bx, by], b: [bx, by] }
  else current = { id: uid(), kind: tool === 'hl' ? 'hl' : 'pen', color: style.color, width, opacity: style.opacity,
    pts: [[bx, by, e.pointerType === 'pen' ? e.pressure || 0.5 : 0.5]], pressure: e.pointerType === 'pen' }
  drag = { mode: 'draw' }
  schedule()
})
hit.addEventListener('pointermove', e => {
  if (drag && drag.mode === 'pan') return panMove(e)
  const [bx, by] = toBoard(e.clientX, e.clientY)
  if (!drag) return hoverAt(bx, by, e.altKey)
  if (drag.mode === 'press') {
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 4) return
    const o = drag.o
    const movable = o && (selected.has(o.id) || DRAWN.has(o.kind) || o.kind === 'image')
    if (movable) {
      if (!selected.has(o.id)) selected = drag.shift ? new Set([...selected, o.id]) : new Set([o.id])
      startMove(e, drag)
    } else {
      if (!drag.shift) selected = new Set()
      drag = { ...drag, mode: 'marquee', base: new Set(selected) }
    }
  }
  if (drag.mode === 'marquee') {
    drag.cx = bx; drag.cy = by
    const box = rectOf(drag.bx, drag.by, bx, by)
    selected = new Set(drag.base)
    for (const o of objects) {
      if (o.kind === 'note') { const p = notePos(o); if (inside(p.x, p.y, box)) selected.add(o.id); continue }
      if (DRAWN.has(o.kind) ? drawingTouches(o, box) : touches(bounds(o), box)) selected.add(o.id)
    }
    schedule()
  } else if (drag.mode === 'draw') {
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : []
    for (const ev of evs.length ? evs : [e]) {
      const [x, y] = toBoard(ev.clientX, ev.clientY)
      if (current.pts) {
        const l = current.pts[current.pts.length - 1]
        if (Math.hypot(x - l[0], y - l[1]) * view.z >= 1) current.pts.push([x, y, ev.pointerType === 'pen' ? ev.pressure || 0.5 : 0.5])
      } else {
        let nx = x, ny = y
        if (e.shiftKey && current.kind === 'arrow') {
          const ang = Math.round(Math.atan2(y - current.a[1], x - current.a[0]) / (Math.PI / 12)) * (Math.PI / 12)
          const len = Math.hypot(x - current.a[0], y - current.a[1])
          nx = current.a[0] + len * Math.cos(ang); ny = current.a[1] + len * Math.sin(ang)
        } else if (e.shiftKey && current.kind === 'box') {
          const s = Math.max(Math.abs(x - current.a[0]), Math.abs(y - current.a[1]))
          nx = current.a[0] + Math.sign(x - current.a[0]) * s; ny = current.a[1] + Math.sign(y - current.a[1]) * s
        }
        current.b = [nx, ny]
      }
    }
    schedule()
  } else if (drag.mode === 'erase') eraseAt(bx, by)
  else if (drag.mode === 'move') moveTo(bx, by)
  else if (drag.mode === 'resize') resizeTo(bx, by, e.shiftKey)
})
hit.addEventListener('pointerup', e => endDrag(e))
hit.addEventListener('pointercancel', e => endDrag(e))
hit.addEventListener('pointerleave', () => { if (!drag && hoverEl) { hoverEl = null; schedule() } })
function drawingTouches(o, box) {
  if (!touches(bounds(o), box)) return false
  if (o.kind === 'pen' || o.kind === 'hl') return o.pts.some(([x, y]) => inside(x, y, box)) || touches(bounds(o), box) && o.pts.length < 3
  return true
}

function endDrag(e) {
  if (!drag) return
  const d = drag
  drag = null
  if (d.mode === 'pan') { hit.classList.remove('panning'); return }
  if (d.mode === 'press') return click(d)
  if (d.mode === 'draw' && current) {
    const it = current
    current = null
    const tiny = it.a && Math.hypot(it.b[0] - it.a[0], it.b[1] - it.a[1]) * view.z < 4
    if (!tiny) change(() => objects.push(it))
    else schedule()
    return
  }
  if (d.mode === 'move' || d.mode === 'resize') changed()
  schedule()
}

// a plain click: select a drawing, or ask what should change here
function click(d) {
  const o = d.o
  if (o && DRAWN.has(o.kind)) {
    if (d.shift) selected.has(o.id) ? selected.delete(o.id) : selected.add(o.id)
    else selected = new Set([o.id])
    return schedule()
  }
  if (d.shift && o) {
    selected.has(o.id) ? selected.delete(o.id) : selected.add(o.id)
    return schedule()
  }
  selected = new Set()
  newNote(o, d.bx, d.by, d.alt)
}
function newNote(o, x, y, alt) {
  const n = { id: uid(), kind: 'note', text: '', _isNew: true }
  if (o && o.kind === 'page') {
    const el = !alt && domAt(o, x, y)
    n.on = o.id
    if (el) { n.el = { ...el }; n._domAt = o.dom.at }
    else { n.px = x - o.x; n.py = Math.max(0, y - o.y - TITLE) }
  } else if (o && o.kind === 'image') {
    const el = !alt && domAt(o, x, y)
    n.on = o.id
    if (el) { n.el = { ...el }; n._domAt = o.dom.at }
    else { n.u = (x - o.x) / o.w; n.v = (y - o.y) / o.h }
  } else { n.x = x; n.y = y }
  objects.push(n)
  openEditor(n)
}
function hoverAt(x, y, alt) {
  let found = null
  if (tool === 'select' && !alt) {
    for (let i = objects.length - 1; i >= 0; i--) {
      const o = objects[i]
      if ((o.kind === 'page' || o.kind === 'image') && inside(x, y, bounds(o))) {
        if (o.kind === 'page' && o.mode !== 'interact') ensureDom(o)
        const el = domAt(o, x, y)
        if (el) found = { o, el }
        break
      }
    }
  }
  if (found?.el !== hoverEl?.el) { hoverEl = found; schedule() }
}

// moving and resizing the selection
function startMove(e, d) {
  const [bx, by] = toBoard(e.clientX, e.clientY)
  pushUndo()
  drag = { mode: 'move', bx: d ? d.bx : bx, by: d ? d.by : by, orig: new Map([...selected].map(id => [id, JSON.parse(JSON.stringify(byId(id), replacer))])) }
  if (!d) hit.setPointerCapture?.(e.pointerId)
  document.addEventListener('pointermove', docMove)
  document.addEventListener('pointerup', docUp)
}
function docMove(e) {
  if (!drag || (drag.mode !== 'move' && drag.mode !== 'resize')) return
  const [bx, by] = toBoard(e.clientX, e.clientY)
  if (drag.mode === 'move') moveTo(bx, by)
  else resizeTo(bx, by, e.shiftKey)
}
function docUp(e) {
  document.removeEventListener('pointermove', docMove)
  document.removeEventListener('pointerup', docUp)
  if (drag && (drag.mode === 'move' || drag.mode === 'resize')) endDrag(e)
}
function shift(o, src, dx, dy) {
  if (o.pts) o.pts = src.pts.map(([x, y, p]) => [x + dx, y + dy, p])
  else if (o.a) { o.a = [src.a[0] + dx, src.a[1] + dy]; o.b = [src.b[0] + dx, src.b[1] + dy] }
  else if (o.kind === 'image' || o.kind === 'page') { o.x = src.x + dx; o.y = src.y + dy }
  else if (o.kind === 'note' && !o.on) { o.x = src.x + dx; o.y = src.y + dy }
}
function moveTo(bx, by) {
  const dx = bx - drag.bx, dy = by - drag.by
  for (const [id, src] of drag.orig) { const o = byId(id); if (o) shift(o, src, dx, dy) }
  schedule()
}
document.querySelectorAll('#selbox .h').forEach(h => h.addEventListener('pointerdown', e => {
  e.stopPropagation(); e.preventDefault()
  const sel = selectionBounds()
  if (!sel) return
  pushUndo()
  drag = { mode: 'resize', h: h.dataset.h, b0: sel, orig: new Map([...selected].map(id => [id, JSON.parse(JSON.stringify(byId(id), replacer))])) }
  document.addEventListener('pointermove', docMove)
  document.addEventListener('pointerup', docUp)
}))
function resizeTo(bx, by, keep) {
  const { h, b0 } = drag
  let x0 = b0.x, y0 = b0.y, x1 = b0.x + b0.w, y1 = b0.y + b0.h
  const min = 8 / view.z
  if (h.includes('w')) x0 = Math.min(bx, x1 - min)
  if (h.includes('e')) x1 = Math.max(bx, x0 + min)
  if (h.includes('n')) y0 = Math.min(by, y1 - min)
  if (h.includes('s')) y1 = Math.max(by, y0 + min)
  let sx = (x1 - x0) / b0.w, sy = (y1 - y0) / b0.h
  const onePage = drag.orig.size === 1 && [...drag.orig.values()][0].kind === 'page'
  const oneImage = drag.orig.size === 1 && [...drag.orig.values()][0].kind === 'image'
  if (!onePage && (keep || oneImage) && h.length === 2) {
    const s = Math.max(sx, sy); sx = sy = s
    if (h.includes('w')) x0 = x1 - b0.w * s
    if (h.includes('n')) y0 = y1 - b0.h * s
  }
  const map = (x, y) => [x0 + (x - b0.x) * sx, y0 + (y - b0.y) * sy]
  for (const [id, src] of drag.orig) {
    const o = byId(id)
    if (!o) continue
    if (o.pts) o.pts = src.pts.map(([x, y, p]) => [...map(x, y), p])
    else if (o.a) { o.a = map(...src.a); o.b = map(...src.b) }
    else if (o.kind === 'image') { [o.x, o.y] = map(src.x, src.y); o.w = src.w * sx; o.h = src.h * sy }
    else if (o.kind === 'page') {
      if (onePage) { o.x = x0; o.y = y0; o.w = Math.max(320, Math.round(x1 - x0)); o.h = Math.max(240, Math.round(y1 - y0 - TITLE)) }
      else [o.x, o.y] = map(src.x, src.y)
    } else if (o.kind === 'note' && !o.on) [o.x, o.y] = map(src.x, src.y)
  }
  schedule()
}

// the eraser deletes whole drawings, never pictures or pages
function eraseAt(x, y) {
  const r = Math.max(style.width / view.z, 4 / view.z)
  const gone = objects.filter(o => DRAWN.has(o.kind) && nearDrawing(o, x, y, r))
  if (!gone.length) return
  if (!drag.pushed) { pushUndo(); drag.pushed = true }
  objects = objects.filter(o => !gone.includes(o))
  changed()
}

// ---------- panning and zooming ----------
function startPan(e) {
  e.preventDefault()
  hit.setPointerCapture(e.pointerId)
  drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, vx: view.x, vy: view.y }
  hit.classList.add('panning')
}
function panMove(e) {
  view.x = drag.vx - (e.clientX - drag.sx) / view.z
  view.y = drag.vy - (e.clientY - drag.sy) / view.z
  schedule()
}
function zoomAt(z, cx, cy) {
  const [bx, by] = toBoard(cx, cy)
  view.z = clamp(z, 0.1, 4)
  const r = stageRect()
  view.x = bx - (cx - r.left) / view.z
  view.y = by - (cy - r.top) / view.z
  schedule(); changedView()
}
let viewTimer = null
function changedView() { clearTimeout(viewTimer); viewTimer = setTimeout(save, 1500) }
function zoomTo(b, fill = 0.9) {
  if (!b) return
  const r = stageRect()
  view.z = clamp(Math.min((r.width * fill) / Math.max(b.w, 1), (r.height * fill) / Math.max(b.h, 1)), 0.1, 4)
  view.x = b.x + b.w / 2 - r.width / 2 / view.z
  view.y = b.y + b.h / 2 - r.height / 2 / view.z
  schedule(); changedView()
}
function viewRect() { const r = stageRect(); return { x: view.x, y: view.y, w: r.width / view.z, h: r.height / view.z } }
function fitAll() { zoomTo(union(objects.map(bounds)) || { x: 0, y: 0, w: 800, h: 600 }) }
stage.addEventListener('wheel', e => {
  if (e.target.closest && e.target.closest('.editor, .modal')) return
  e.preventDefault()
  hoverEl = null
  if (e.ctrlKey || e.metaKey) return zoomAt(view.z * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY)
  // over a page: the page scrolls, as it does in chrome. over the board: the board pans
  const [bx, by] = toBoard(e.clientX, e.clientY)
  const p = pageBodyAt(bx, by)
  if (p && live && !spaceDown) return scrollPage(p, e)
  view.x += e.deltaX / view.z; view.y += e.deltaY / view.z; schedule(); changedView()
}, { passive: false })

// ---------- pages behave like chrome: real scrolling, and ⌘-click to click through ----------
function pageBodyAt(x, y) {
  for (let i = objects.length - 1; i >= 0; i--) {
    const o = objects[i]
    if (o.kind === 'page' && x >= o.x && x <= o.x + o.w && y >= o.y + TITLE && y <= o.y + TITLE + o.h) return o
    if ((o.kind === 'page' || o.kind === 'image') && inside(x, y, bounds(o))) return null
  }
  return null
}
// real chrome input at a point of a page: its frame takes the pointer for that moment only
async function sendInput(p, events) {
  const frame = pagesEl.querySelector(`[data-id="${p.id}"] iframe`)
  if (!frame) return
  frame.style.pointerEvents = 'auto'
  try { await api('/pages/input', { method: 'POST', body: JSON.stringify(events) }) } catch {}
  finally { frame.style.pointerEvents = '' }
  if (p.dom) p.dom.at = 0 // the page moved under its notes' outlines: read it again on the next hover
}
const wheelQueue = { p: null, dx: 0, dy: 0, x: 0, y: 0, busy: false }
function scrollPage(p, e) {
  const q = wheelQueue
  if (q.p && q.p !== p) { q.dx = 0; q.dy = 0 }
  q.p = p; q.x = e.clientX; q.y = e.clientY
  const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1
  q.dx += e.deltaX * unit; q.dy += e.deltaY * unit
  if (!q.busy) flushWheel()
}
async function flushWheel() {
  const q = wheelQueue
  if (!q.dx && !q.dy) return
  q.busy = true
  const ev = { type: 'wheel', x: q.x, y: q.y, dx: q.dx, dy: q.dy }
  q.dx = 0; q.dy = 0
  await sendInput(q.p, [ev])
  q.busy = false
  if (q.dx || q.dy) flushWheel()
}
window.addEventListener('resize', schedule)

// ---------- the note box: "What should be changed here?" ----------
function noteTitle(n) {
  if (n.el) return elName(n.el)
  const p = parentOf(n)
  const letter = p ? pageLetters().get(p.id) : null
  if (p && p.kind === 'page') return `page ${letter}`
  if (p && p.kind === 'image') return letter ? `page ${letter} (snapshot)` : (p.name || 'image')
  return 'board'
}
function openEditor(n) {
  if (editing && editing !== n) closeEditor(true)
  editing = n
  hoverEl = null
  editorEl && editorEl.remove()
  const p = parentOf(n)
  const chain = n.el && p && p.dom && p.dom.at === n._domAt ? [...ancestors(p, p.dom.elements[n.el.i] || n.el).reverse(), p.dom.elements[n.el.i] || n.el] : []
  editorEl = document.createElement('div')
  editorEl.className = 'editor'
  editorEl.innerHTML = `
    <div class="head"><span>Note ${noteNumber(n)} · ${esc(noteTitle(n))}</span><span>↵ save · esc close</span></div>
    ${n.el ? `<div class="src">${esc(n.el.src || n.el.sel)}${n.el.text ? ` · "${esc(n.el.text.slice(0, 50))}"` : ''}</div>` : ''}
    ${chain.length > 1 ? `<div class="crumbs">${chain.map(c =>
      `<button data-i="${c.i}" class="${c.i === n.el.i ? 'on' : ''}" title="${esc(c.sel)}">${esc((c.comp && c.comp[0]) || c.tag)}</button>`).join('')}</div>` : ''}
    <textarea placeholder="What should be changed here?"></textarea>
    <div class="row">
      ${n._isNew ? '' : '<button class="round del" title="Delete this note">🗑</button>'}
      <button class="round no" title="Close (Esc)">✕</button>
      <button class="round yes" title="Save (Enter)">✓</button>
    </div>`
  const ta = editorEl.querySelector('textarea')
  ta.value = n.text
  editorEl.querySelector('.yes').onclick = () => closeEditor(true)
  editorEl.querySelector('.no').onclick = () => closeEditor(false)
  const del = editorEl.querySelector('.del')
  if (del) del.onclick = () => { const id = n.id; closeEditor(false, true); change(() => { objects = objects.filter(o => o.id !== id) }) }
  editorEl.querySelectorAll('.crumbs button').forEach(b => (b.onclick = () => {
    const typed = ta.value
    const el = p.dom.elements[+b.dataset.i]
    if (!el) return
    n.el = { ...el }
    openEditor(n)
    editorEl.querySelector('textarea').value = typed
  }))
  ta.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); closeEditor(true) }
    else if (e.key === 'Escape') { e.preventDefault(); closeEditor(false) }
    e.stopPropagation()
  })
  editorEl.addEventListener('pointerdown', e => e.stopPropagation())
  $('overlay').appendChild(editorEl)
  placeEditor()
  ta.focus()
  schedule()
}
function placeEditor() {
  const p = notePos(editing)
  const [sx, sy] = toScreen(p.x, p.y)
  const w = 300, h = editorEl.offsetHeight
  let left = sx + 22, top = sy - 20
  if (left + w > stage.clientWidth - 8) left = sx - w - 22
  editorEl.style.left = `${Math.max(8, left)}px`
  editorEl.style.top = `${clamp(top, 8, stage.clientHeight - h - 8)}px`
}
// ✓ keeps what was typed (an empty new note goes away); ✕ drops the change
function closeEditor(save, quiet) {
  if (!editing) return
  const n = editing
  const text = editorEl ? editorEl.querySelector('textarea').value.trim() : n.text
  editing = null
  editorEl && editorEl.remove(); editorEl = null
  if (quiet) return schedule()
  if (n._isNew) {
    objects = objects.filter(o => o !== n)
    if (save && text) { delete n._isNew; n.text = text; change(() => objects.push(n)) }
    else schedule()
  } else if (save && text !== n.text && text) change(() => { n.text = text })
  else schedule()
}

// ---------- the palette ----------
COLORS.forEach((c, i) => {
  const b = document.createElement('button')
  b.className = 'swatch'
  b.style.background = c
  b.title = `${c} (${i + 1})`
  b.dataset.color = c
  b.onclick = () => setColor(c)
  $('swatches').appendChild(b)
})
document.querySelectorAll('[data-tool]').forEach(b => (b.onclick = () => setTool(b.dataset.tool)))
function setTool(t) {
  tool = t
  if (t !== 'select') { closeEditor(true); hoverEl = null }
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === t))
  hit.classList.toggle('draw', t !== 'select')
  schedule()
}
function syncPalette() {
  document.querySelectorAll('.swatch').forEach(b => b.classList.toggle('on', b.dataset.color === style.color))
  $('width').value = style.width
  $('opacity').value = Math.round(style.opacity * 100)
}
// with drawings selected the palette restyles them; otherwise it sets the next drawing
function restyle(fn) {
  const list = selectedDrawings()
  if (list.length) change(() => list.forEach(fn))
}
function setColor(c) {
  style.color = c
  restyle(o => { o.color = c })
  if (!selectedDrawings().length && tool === 'select') setTool('pen')
  syncPalette(); changedView()
}
$('custom').oninput = e => setColor(e.target.value)
$('width').oninput = e => { style.width = +e.target.value; restyle(o => { o.width = style.width / view.z }); changedView() }
$('opacity').oninput = e => { style.opacity = +e.target.value / 100; restyle(o => { o.opacity = style.opacity }); changedView() }

// ---------- selection actions, clipboard ----------
function withNotes(ids) {
  const set = new Set(ids)
  for (const n of notes()) if (n.on && set.has(n.on)) set.add(n.id)
  return objects.filter(o => set.has(o.id))
}
function deleteSelection() {
  if (!selected.size) return
  const gone = new Set(withNotes([...selected]).map(o => o.id))
  change(() => { objects = objects.filter(o => !gone.has(o.id)) })
  selected = new Set()
}
function copySelection(cut) {
  if (!selected.size) return
  clipboard = { at: Date.now(), objects: JSON.parse(JSON.stringify(withNotes([...selected]), replacer)) }
  writeSystemClipboard()
  if (cut) deleteSelection()
  status(`${clipboard.objects.length} copied`)
}
async function writeSystemClipboard() {
  try {
    const png = await renderSet([...selected].map(byId).filter(Boolean), { snapshots: false })
    const blob = await (await fetch(`data:image/png;base64,${png.base64}`)).blob()
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob, 'text/plain': new Blob([`sketch-objects:${clipboard.at}`], { type: 'text/plain' }) })])
  } catch {
    // the system clipboard was not written: ⌘V pastes these objects, not whatever it still holds
    if (clipboard) clipboard.local = true
  }
}
// pasted copies land where the originals were, offset until none sits exactly on another
function pasteObjects(list) {
  if (!list || !list.length) return
  const ids = new Map(list.map(o => [o.id, uid()]))
  const copies = list.map(o => {
    const c = JSON.parse(JSON.stringify(o))
    c.id = ids.get(o.id)
    if (c.kind === 'note' && c.on) { if (ids.has(c.on)) c.on = ids.get(c.on); else { const p = notePos(o); delete c.on; delete c.el; c.x = p.x; c.y = p.y } }
    return c
  })
  const step = 16 / view.z
  const free = copies.filter(c => c.kind !== 'note' || !c.on)
  const first = free[0]
  let off = 0
  const pos = o => { const b = bounds(o); return `${Math.round(b.x)},${Math.round(b.y)}` }
  const taken = new Set(objects.map(pos))
  if (first) {
    const sample = JSON.parse(JSON.stringify(first))
    for (off = step; off < step * 60; off += step) { shift(sample, first, off, off); if (!taken.has(pos(sample))) break }
    for (const c of free) shift(c, JSON.parse(JSON.stringify(c)), off, off)
  }
  change(() => objects.push(...copies))
  selected = new Set(copies.filter(c => c.kind !== 'note').map(c => c.id))
}
function duplicate() { if (selected.size) pasteObjects(JSON.parse(JSON.stringify(withNotes([...selected]), replacer))) }
function reorder(up) {
  if (!selected.size) return
  change(() => {
    const sel = objects.filter(o => selected.has(o.id)), rest = objects.filter(o => !selected.has(o.id))
    objects = up ? [...rest, ...sel] : [...sel, ...rest]
  })
}
document.querySelectorAll('#seltools button').forEach(b => (b.onclick = () => {
  ({ copy: () => copySelection(false), duplicate, delete: deleteSelection, front: () => reorder(true), back: () => reorder(false) })[b.dataset.act]()
}))
function nudge(dx, dy, grow) {
  if (!selected.size) return
  change(() => {
    for (const id of selected) {
      const o = byId(id)
      if (!o) continue
      if (grow && (o.kind === 'image' || o.kind === 'page')) { o.w = Math.max(20, o.w + dx); o.h = Math.max(20, o.h + dy) }
      else shift(o, JSON.parse(JSON.stringify(o)), dx, dy)
    }
  })
}

// ---------- images ----------
async function addImage(blob, name, at) {
  let bmp
  try { bmp = await createImageBitmap(blob) } catch {
    status('converting the image…')
    const ext = (name || '').split('.').pop() || (blob.type || '').split('/').pop() || ''
    const res = await api(`/convert?ext=${encodeURIComponent(ext)}`, { method: 'POST', body: blob })
    if (!res.ok) return status('this image could not be read')
    blob = await res.blob()
    bmp = await createImageBitmap(blob)
  }
  const src = uid()
  bitmaps.set(src, bmp); blobs.set(src, blob); saveImage(src)
  const r = stageRect()
  const scale = Math.min(1, (r.width * 0.6) / view.z / bmp.width, (r.height * 0.6) / view.z / bmp.height)
  const w = bmp.width * scale, h = bmp.height * scale
  // dropped: where it was dropped; otherwise a clear spot
  const [x, y] = at ? [at[0] - w / 2, at[1] - h / 2] : freeSpot(w, h)
  const img = { id: uid(), kind: 'image', src, name: name || 'image', x, y, w, h, nw: bmp.width, nh: bmp.height }
  change(() => objects.push(img))
  selected = new Set([img.id])
  // placed beside everything else, out of view: zoom out just enough to show it too
  const seen = viewRect()
  if (!at && !(inside(x, y, seen) && inside(x + w, y + h, seen))) zoomTo(union([seen, bounds(img)]), 0.95)
  status(`added ${name || 'an image'}`)
  closeModals()
  return img
}
async function addFiles(files, cx, cy) {
  const list = [...files].filter(f => f.type.startsWith('image/') || /\.(heic|heif|tiff?)$/i.test(f.name))
  let at = cx != null ? toBoard(cx, cy) : null
  for (const f of list) {
    const img = await addImage(f, f.name, at)
    if (img && at) at = [img.x + img.w * 1.5 + 24, at[1]]
  }
}
$('file').onchange = e => { addFiles(e.target.files); e.target.value = '' }
let dragDepth = 0
window.addEventListener('dragenter', e => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging') })
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging') } })
window.addEventListener('dragover', e => e.preventDefault())
window.addEventListener('drop', e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove('dragging')
  if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files, e.clientX, e.clientY)
})
window.addEventListener('paste', e => {
  if (e.target.closest && e.target.closest('input, textarea')) return
  e.preventDefault()
  const text = e.clipboardData?.getData('text/plain') || ''
  if (clipboard && (clipboard.local || text === `sketch-objects:${clipboard.at}`)) return pasteObjects(clipboard.objects)
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'))
  if (item) return addImage(item.getAsFile(), 'pasted image')
  if (text.trim()) {
    const r = stageRect()
    const [x, y] = toBoard(r.left + r.width / 2, r.top + r.height / 2)
    change(() => objects.push({ id: uid(), kind: 'note', text: text.trim().slice(0, 2000), x, y }))
    return
  }
  if (clipboard) pasteObjects(clipboard.objects)
})

// ---------- screenshots of open windows ----------
function openModal(id) { document.querySelectorAll('.modal').forEach(m => m.classList.toggle('open', m.id === id)) }
function closeModals() { document.querySelectorAll('.modal').forEach(m => m.classList.remove('open')) }
const modalOpen = () => !!document.querySelector('.modal.open')
document.querySelectorAll('.modal').forEach(m => {
  m.addEventListener('pointerdown', e => { if (e.target === m) closeModals() })
  m.querySelectorAll('[data-close]').forEach(b => (b.onclick = closeModals))
})
// ---------- the add picker: local server, screenshot or image, as tabs ----------
let tab = 'server'
function openAdd(which) {
  closeEditor(true)
  openModal('addmodal')
  showTab(which || tab)
}
function showTab(which) {
  tab = which
  document.querySelectorAll('.tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === which))
  document.querySelectorAll('.tabpane').forEach(p => p.classList.toggle('on', p.dataset.pane === which))
  $('shots-refresh').style.display = which === 'image' ? 'none' : ''
  $('shots-sub').textContent = ''
  if (which === 'server') loadServers()
  if (which === 'shots') loadShots()
}
document.querySelectorAll('.tabs [data-tab]').forEach(b => (b.onclick = () => showTab(b.dataset.tab)))
$('shots-refresh').onclick = () => showTab(tab)
$('choosefile').onclick = () => $('file').click()
const addOpen = () => $('addmodal').classList.contains('open')

async function loadShots() {
  const body = $('shots-body')
  body.innerHTML = '<div class="dim">Looking at your windows…</div>'
  const data = await api('/windows').then(r => r.json()).catch(err => ({ ok: false, error: String(err) }))
  if (!addOpen() || tab !== 'shots') return
  if (!data.ok) { body.innerHTML = `<div class="ask">${esc(data.error || 'could not list the windows')}</div>`; return }
  if (!data.permission) {
    body.innerHTML = `<div class="ask">
      <p><b>macOS needs to let your terminal take screenshots.</b></p>
      <ol><li>Open <b>Screen Recording</b> settings (the button below).</li>
        <li>Turn on the app you run Claude Code in (iTerm2, Terminal, Ghostty, …).</li>
        <li>Quit and reopen that app, then run <code>claude --resume</code> and <code>/sketch</code> again.</li></ol>
      <p><button class="accent" id="shots-settings">Open Screen Recording settings</button></p></div>`
    $('shots-settings').onclick = () => api('/screen-settings', { method: 'POST' })
    return
  }
  const wins = data.windows || []
  $('shots-sub').textContent = `${wins.length} window${wins.length === 1 ? '' : 's'}`
  body.innerHTML = wins.length ? '<div class="grid"></div>' : '<div class="dim">No windows to show.</div>'
  for (const w of wins) {
    const b = document.createElement('button')
    b.className = 'shot'
    b.innerHTML = `<div class="img" style="background-image:url(data:image/jpeg;base64,${w.thumb})"></div>
      <div class="app">${esc(w.app || 'Window')}</div><div class="ttl">${esc(w.title || `${w.w} × ${w.h}`)}</div>`
    b.onclick = async () => {
      $('shots-sub').textContent = `capturing ${w.app}…`
      const res = await api(`/capture?id=${w.id}`, { method: 'POST' }).catch(() => null)
      if (!res || !res.ok) { $('shots-sub').textContent = 'macOS did not allow that screenshot'; return }
      closeModals()
      addImage(await res.blob(), `${w.app}${w.title ? ` – ${w.title}` : ''}`)
    }
    body.firstChild.appendChild(b)
  }
}

// the local servers, each a card with the title its page gives
async function loadServers() {
  setTimeout(() => { if (tab === 'server' && !$('servers').firstChild) $('pageurl').focus() }, 30)
  $('livehint').textContent = live ? ''
    : 'This window is not running in the inspect profile, so pages show live but their components cannot be read. Reopen /sketch with Chrome installed.'
  const rec = $('recent')
  rec.innerHTML = recent.length ? 'Recent:' : ''
  for (const u of recent) rec.appendChild(chip(u.replace(/^https?:\/\//, ''), () => { addPage(u, $('pagesize').value); closeModals() }))
  const box = $('servers')
  $('servers-label').textContent = 'Looking for local servers…'
  const data = await api('/servers').then(r => r.json()).catch(() => ({ servers: [] }))
  if (!addOpen() || tab !== 'server') return
  const list = data.servers || (data.ports || []).map(port => ({ port }))
  $('servers-label').textContent = list.length ? 'Running on this Mac: pick one' : 'No local dev servers found: start one, then ↻ Refresh, or type a URL'
  box.innerHTML = ''
  list.forEach((s, i) => {
    const b = document.createElement('button')
    b.className = 'server'
    b.innerHTML = `<span class="port">localhost:${s.port}</span><span class="what">${esc(s.title || s.cmd || '')}</span>`
    b.onclick = () => { addPage(`http://localhost:${s.port}`, $('pagesize').value); closeModals() }
    box.appendChild(b)
    if (i === 0) setTimeout(() => b.focus(), 40)
  })
}
function chip(label, fn) { const b = document.createElement('button'); b.className = 'chip'; b.textContent = label; b.onclick = fn; return b }
$('addpage').onclick = () => openAdd('server')
$('shoot').onclick = () => openAdd('shots')
$('openimg').onclick = () => openAdd('image')
$('pageadd').onclick = () => { const u = $('pageurl').value; if (u.trim()) { addPage(u, $('pagesize').value); closeModals() } }

$('pageurl').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); $('pageadd').click() }
  else if (e.key === 'Escape') closeModals()
  e.stopPropagation()
})

// ---------- menus ----------
function popup(anchor, items) {
  const pop = $('pop')
  pop.innerHTML = ''
  for (const [label, key, fn] of items) {
    const b = document.createElement('button')
    b.innerHTML = `<span>${esc(label)}</span>${key ? `<kbd>${esc(key)}</kbd>` : ''}`
    b.onclick = () => { closePop(); fn() }
    pop.appendChild(b)
  }
  const r = anchor.getBoundingClientRect()
  pop.style.display = 'flex'
  pop.style.left = `${Math.min(r.left, window.innerWidth - 220)}px`
  pop.style.top = `${r.bottom + 6}px`
  setTimeout(() => document.addEventListener('pointerdown', closePopOutside), 0)
}
function closePop() { $('pop').style.display = 'none'; document.removeEventListener('pointerdown', closePopOutside) }
function closePopOutside(e) { if (!$('pop').contains(e.target)) closePop() }
function zoomCenter(z) { const r = stageRect(); zoomAt(z, r.left + r.width / 2, r.top + r.height / 2) }
$('zoom').onclick = e => popup(e.currentTarget, [
  ['Fit all', '⇧1', fitAll],
  ['Zoom to selection', '⇧2', () => zoomTo(selectionBounds())],
  ['Zoom in', '⌘+', () => zoomCenter(view.z * 1.25)],
  ['Zoom out', '⌘−', () => zoomCenter(view.z / 1.25)],
  ['50%', '', () => zoomCenter(0.5)],
  ['100%', '⌘0', () => zoomCenter(1)],
  ['200%', '', () => zoomCenter(2)],
])
$('boardmenu').onclick = e => popup(e.currentTarget, [
  ['New board', '', async () => {
    await save()
    await api('/board/new', { method: 'POST' })
    pushUndo()
    objects = []; selected = new Set(); closeEditor(false, true)
    changed()
    status('new board: the last one is kept in .claude/sketches/board/')
  }],
  ['Select all', '⌘A', () => { selected = new Set(objects.map(o => o.id)); schedule() }],
])
$('undo').onclick = undo
$('redo').onclick = redo
$('full').onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}))

// ---------- export and attach ----------
function where(x, y, b) {
  const row = y < b.y + b.h / 3 ? 'top' : y > b.y + (b.h * 2) / 3 ? 'bottom' : 'middle'
  const col = x < b.x + b.w / 3 ? 'left' : x > b.x + (b.w * 2) / 3 ? 'right' : 'center'
  return row === 'middle' && col === 'center' ? 'center' : row === 'middle' ? `middle ${col}` : `${row} ${col}`
}
function wrap(ctx, text, maxW) {
  const out = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(/\s+/)) {
      const t = line ? `${line} ${word}` : word
      if (ctx.measureText(t).width > maxW && line) { out.push(line); line = word } else line = t
    }
    out.push(line)
  }
  return out
}
// pins, bubbles and component outlines, sized for a picture of `size` pixels drawn at scale k
function drawNotes(ctx, list, k, size, B) {
  const u = Math.max(size / 1400, 0.6) / k
  for (const n of list) {
    const b = noteBox(n)
    if (b) {
      ctx.save(); ctx.setLineDash([8 * u, 5 * u]); ctx.lineWidth = 2.5 * u; ctx.strokeStyle = NOTE
      ctx.fillStyle = 'rgba(110,86,207,.08)'; ctx.fillRect(b.x, b.y, b.w, b.h); ctx.strokeRect(b.x, b.y, b.w, b.h); ctx.restore()
    }
    const p = notePos(n), r = 15 * u
    ctx.save()
    ctx.font = `500 ${16 * u}px -apple-system, system-ui, sans-serif`
    const maxW = 380 * u
    const lines = wrap(ctx, n.text, maxW - 20 * u)
    const lh = 21 * u
    const bw = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width)) + 20 * u)
    const bh = lines.length * lh + 14 * u
    // the bubble sits right of its pin, or left of it where the picture ends. a note on a component
    // keeps its bubble off the component, so the picture still shows what the note is about
    let bx = p.x + r + 8 * u, by = p.y - r
    const fits = (x, y) => !B || (x >= B.x + 6 * u && y >= B.y + 6 * u && x + bw <= B.x + B.w - 6 * u && y + bh <= B.y + B.h - 6 * u)
    let joined = false
    if (b) {
      const gap = 14 * u
      const spots = [[b.x + b.w + gap, b.y], [b.x - gap - bw, b.y], [b.x, b.y + b.h + gap], [b.x, b.y - gap - bh]]
      const spot = spots.find(([x, y]) => fits(x, y))
      if (spot) { [bx, by] = spot; joined = true }
    }
    if (!joined && B && bx + bw > B.x + B.w - 6 * u) bx = p.x - r - 8 * u - bw
    if (B) { bx = clamp(bx, B.x + 6 * u, Math.max(B.x + 6 * u, B.x + B.w - bw - 6 * u)); by = clamp(by, B.y + 6 * u, B.y + B.h - bh - 6 * u) }
    if (joined) {
      ctx.save(); ctx.strokeStyle = NOTE; ctx.lineWidth = 2 * u
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(clamp(p.x, bx, bx + bw), clamp(p.y, by, by + bh)); ctx.stroke(); ctx.restore()
    }
    ctx.fillStyle = 'rgba(255,255,255,.96)'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.6 * u
    ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(bx, by, bw, bh, 8 * u); else ctx.rect(bx, by, bw, bh)
    ctx.fill(); ctx.stroke()
    ctx.fillStyle = '#111'; ctx.textBaseline = 'top'
    lines.forEach((l, j) => ctx.fillText(l, bx + 10 * u, by + 8 * u + j * lh))
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fillStyle = NOTE; ctx.fill(); ctx.lineWidth = 3 * u; ctx.strokeStyle = '#fff'; ctx.stroke()
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
    ctx.font = `700 ${15 * u}px -apple-system, system-ui, sans-serif`
    ctx.fillText(String(noteNumber(n)), p.x, p.y + 0.5 * u)
    ctx.restore()
  }
}
function noteExtent(n) {
  const p = notePos(n)
  return { x: p.x - 20, y: p.y - 20, w: 440, h: 40 + Math.ceil(n.text.length / 40) * 24 }
}
// a live page, as it is now: the board shows it at a size that fits, and the sketch window takes a picture of it
async function snapshotPage(p) {
  if (!live) return null
  const saved = { ...view }
  const r = stageRect()
  const z = Math.min(1, (r.width - 4) / p.w, (r.height - 4) / p.h)
  view = { x: p.x, y: p.y + TITLE, z }
  document.body.classList.add('capturing')
  render()
  await frames(3)
  const q = new URLSearchParams({ x: r.left, y: r.top, w: p.w * z, h: p.h * z, scale: 1 / z })
  const res = await api(`/pages/snapshot?${q}`, { method: 'POST' }).catch(() => null)
  document.body.classList.remove('capturing')
  view = saved
  render()
  if (!res || !res.ok) return null
  return createImageBitmap(await res.blob()).catch(() => null)
}
// a picture of a set of objects, with the notes on them
async function renderSet(set, { snapshots = true, pad = 32, max = 2400 } = {}) {
  const shown = new Set(withNotes(set.map(o => o.id)).map(o => o.id))
  const list = objects.filter(o => shown.has(o.id))
  const ns = list.filter(o => o.kind === 'note')
  const b0 = union([...list.filter(o => o.kind !== 'note').map(bounds), ...ns.map(noteExtent)])
  if (!b0) return null
  const B = { x: b0.x - pad, y: b0.y - pad, w: b0.w + pad * 2, h: b0.h + pad * 2 }
  const k = Math.min(2, max / Math.max(B.w, B.h))
  const shots = new Map()
  if (snapshots) for (const p of list) if (p.kind === 'page') shots.set(p.id, await snapshotPage(p))
  const c = document.createElement('canvas')
  c.width = Math.round(B.w * k); c.height = Math.round(B.h * k)
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height)
  ctx.setTransform(k, 0, 0, k, -B.x * k, -B.y * k)
  ctx.imageSmoothingQuality = 'high'
  const letters = pageLetters()
  for (const o of list) {
    if (o.kind === 'image') { const bmp = bitmaps.get(o.src); if (bmp) ctx.drawImage(bmp, o.x, o.y, o.w, o.h) }
    if (o.kind === 'page') {
      ctx.fillStyle = '#24262c'; ctx.fillRect(o.x, o.y, o.w, TITLE)
      ctx.fillStyle = '#fff'; ctx.font = '600 14px -apple-system, system-ui, sans-serif'; ctx.textBaseline = 'middle'
      ctx.fillText(`${letters.get(o.id) || ''}   ${o.url}`, o.x + 12, o.y + TITLE / 2)
      const s = shots.get(o.id)
      if (s) ctx.drawImage(s, o.x, o.y + TITLE, o.w, o.h)
      else { ctx.fillStyle = '#f0f0f3'; ctx.fillRect(o.x, o.y + TITLE, o.w, o.h); ctx.fillStyle = '#888'; ctx.fillText('live page', o.x + 16, o.y + TITLE + 24) }
    }
  }
  for (const o of list) if (DRAWN.has(o.kind)) drawShape(ctx, o)
  drawNotes(ctx, ns, k, Math.max(c.width, c.height), B)
  return { base64: c.toDataURL('image/png').split(',')[1], k, B, list, shots }
}
// a readable picture of one page with its notes, for when the overview makes it small
function cropPage(p, shot) {
  const k = Math.min(2, 1600 / p.w)
  const c = document.createElement('canvas')
  const h = p.kind === 'page' ? p.h : p.h
  c.width = Math.round(p.w * k); c.height = Math.round(h * k)
  const ctx = c.getContext('2d')
  const oy = p.kind === 'page' ? p.y + TITLE : p.y
  ctx.setTransform(k, 0, 0, k, -p.x * k, -oy * k)
  ctx.fillStyle = '#fff'; ctx.fillRect(p.x, oy, p.w, h)
  if (shot) ctx.drawImage(shot, p.x, oy, p.w, h)
  drawNotes(ctx, notes().filter(n => n.on === p.id), k, Math.max(c.width, c.height), { x: p.x, y: oy, w: p.w, h })
  return c.toDataURL('image/png').split(',')[1]
}
async function attach() {
  if (finished) return
  closeEditor(true)
  const set = selected.size ? [...selected].map(byId).filter(Boolean) : objects.slice()
  if (!set.length) return status('add a note, a drawing or a page first')
  $('attach').disabled = true
  status('saving…')
  try {
    const out = await renderSet(set)
    const letters = pageLetters()
    const pagesIn = out.list.filter(o => o.kind === 'page' || (o.kind === 'image' && o.page))
    const pages = pagesIn.map(p => {
      const entry = { letter: letters.get(p.id), url: p.kind === 'page' ? p.url : p.page.url, title: p.kind === 'page' ? p.title : p.page.title }
      if (p.w * out.k < 1000) entry.png = cropPage(p, p.kind === 'page' ? out.shots.get(p.id) : bitmaps.get(p.src))
      return entry
    }).sort((a, b) => a.letter.localeCompare(b.letter))
    const ns = out.list.filter(o => o.kind === 'note' && o.text)
    const noteList = ns.map(n => {
      const p = parentOf(n)
      const letter = p ? letters.get(p.id) : undefined
      let w
      if (!p) w = `board, ${where(n.x, n.y, out.B)}`
      else if (n.el) w = ''
      else if (p.kind === 'page') w = where(n.px, n.py, { x: 0, y: 0, w: p.w, h: p.h })
      else w = `${letter ? '' : `${p.name || 'image'}, `}${where(n.u, n.v, { x: 0, y: 0, w: 1, h: 1 })}`
      return {
        n: noteNumber(n), text: n.text, where: w, on: letter,
        element: n.el ? { component: n.el.comp || [], source: n.el.src || '', tag: n.el.tag, text: n.el.text || '', selector: n.el.sel || '', testid: n.el.testid || '' } : undefined,
      }
    })
    const body = JSON.stringify({ png: out.base64, note: $('prompt').value, notes: noteList, pages })
    await save()
    const res = await api('/done', { method: 'POST', body, headers: { 'Content-Type': 'application/json' } })
    if (!res.ok) throw new Error(await res.text())
    finished = true
    document.body.classList.add('finished')
    setTimeout(() => window.close(), 700)
  } catch (err) {
    $('attach').disabled = false
    status(`could not attach: ${err.message || err}`)
  }
}
let cancelArmed = null
async function cancel() {
  if (!cancelArmed) {
    $('cancel').textContent = 'Close without attaching?'; $('cancel').classList.add('confirm')
    cancelArmed = setTimeout(() => { cancelArmed = null; $('cancel').textContent = 'Cancel'; $('cancel').classList.remove('confirm') }, 2500)
    return
  }
  await save()
  finished = true
  await api('/cancel', { method: 'POST' }).catch(() => {})
  window.close()
}
$('attach').onclick = attach
$('cancel').onclick = cancel
window.addEventListener('pagehide', () => { if (!finished) { navigator.sendBeacon(`/gone?t=${T}`) } })
$('prompt').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); attach() } })

let statusTimer = null
function status(t) {
  $('status').textContent = t || ''
  clearTimeout(statusTimer)
  if (t) statusTimer = setTimeout(() => ($('status').textContent = ''), 6000)
}
function updateSendInfo() {
  const n = selected.size
  $('sendinfo').textContent = n ? `attaches the ${n} selected` : objects.length ? 'attaches the whole board' : ''
}
setInterval(updateSendInfo, 400)

// ---------- keys ----------
window.addEventListener('keydown', e => {
  const typing = e.target.closest && e.target.closest('input, textarea, select')
  const mod = e.metaKey || e.ctrlKey
  if (mod && e.key === 'Enter') { e.preventDefault(); return attach() }
  if (typing) return
  if (modalOpen()) {
    if (e.key === 'Escape') closeModals()
    else if (e.key.toLowerCase() === 'r' && addOpen()) showTab(tab)
    return
  }
  const k = e.key.toLowerCase()
  if (e.key === ' ') { spaceDown = true; document.body.classList.add('space'); e.preventDefault(); return }
  if (mod && k === 'z') { e.preventDefault(); return e.shiftKey ? redo() : undo() }
  if (mod && k === 'c') { e.preventDefault(); return copySelection(false) }
  if (mod && k === 'x') { e.preventDefault(); return copySelection(true) }
  if (mod && k === 'd') { e.preventDefault(); return duplicate() }
  if (mod && k === 'a') { e.preventDefault(); selected = new Set(objects.map(o => o.id)); return schedule() }
  if (mod && (k === '=' || k === '+')) { e.preventDefault(); return zoomCenter(view.z * 1.25) }
  if (mod && k === '-') { e.preventDefault(); return zoomCenter(view.z / 1.25) }
  if (mod && k === '0') { e.preventDefault(); return zoomCenter(1) }
  if (mod || e.altKey && !k.startsWith('arrow')) return
  if (e.shiftKey && e.code === 'Digit1') return fitAll()
  if (e.shiftKey && e.code === 'Digit2') return zoomTo(selectionBounds())
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); return deleteSelection() }
  if (k.startsWith('arrow')) {
    e.preventDefault()
    const s = (e.shiftKey ? 10 : 1) / view.z
    const [dx, dy] = { arrowleft: [-s, 0], arrowright: [s, 0], arrowup: [0, -s], arrowdown: [0, s] }[k]
    return nudge(dx, dy, e.altKey)
  }
  if (e.key === 'Escape') {
    if (editing) return closeEditor(false)
    if (tool !== 'select') return setTool('select')
    selected = new Set(); return schedule()
  }
  const tools = { v: 'select', p: 'pen', h: 'hl', a: 'arrow', b: 'box', e: 'erase' }
  if (tools[k]) return setTool(tools[k])
  if (k >= '1' && k <= String(COLORS.length) && !e.shiftKey) return setColor(COLORS[+k - 1])
  if (k === '[' || k === ']') { style.width = clamp(style.width + (k === ']' ? 2 : -2), 1, 40); syncPalette(); return }
  if (k === 'w') return openAdd('server')
  if (k === 's') return openAdd('shots')
  if (k === 'o') return openAdd('image')
  if (k === 'f') return $('full').click()
})
window.addEventListener('keyup', e => { if (e.key === ' ') { spaceDown = false; document.body.classList.remove('space') } })
window.addEventListener('blur', () => { spaceDown = false; document.body.classList.remove('space') })

// ---------- start ----------
async function start() {
  try { window.moveTo(0, 0); window.resizeTo(screen.availWidth, screen.availHeight) } catch {}
  setTool('select')
  const st = await api('/status').then(r => r.json()).catch(() => ({}))
  live = !!st.live
  await loadBoard()
  syncPalette()
  render()
  if (HAS_IMAGE) {
    const res = await api('/image').catch(() => null)
    if (res && res.ok) await addImage(await res.blob(), 'image')
  }
  if (objects.length && !HAS_IMAGE) status(`your last board: ${objects.length} item${objects.length === 1 ? '' : 's'} · ⋯ › New board to start fresh`)
  schedule()
  // every /sketch starts by asking what to look at: a local server first, a screenshot or an image a tab away
  if (!HAS_IMAGE) openAdd('server')
}
start()
