// sketch notes: runs inside an inspected page (through Chrome's DevTools protocol) and returns every
// visible element: where it is, a short css selector, its text, and the component that rendered it
// (React, Vue or Svelte, with the source file and line where the dev build keeps them).
(async () => {
  const MAX = 2500
  const vw = window.innerWidth, vh = window.innerHeight
  const LIB = /node_modules|\/@vite\/|\/@react-refresh|\/@id\/|react-dom|react\.development|jsx-dev-runtime|scheduler|webpack\/runtime/

  // the first frame of a React 19 element's creation stack that is the app's own code:
  // "at Name (URL:line:col)" or "at URL:line:col", the URL possibly holding parentheses
  function fromStack(stack) {
    if (!stack) return null
    for (const raw of String(stack).split('\n').slice(1)) {
      const line = raw.trim()
      // a server component's frame reads "about://React/Server/<url>": its map is on the server
      const m = line.match(/^at (?:.*? \()?(?:about:\/\/React\/Server\/)?((?:https?|webpack-internal|file|turbopack):\/\/.+?):(\d+):(\d+)\)?$/)
      if (!m || LIB.test(m[1])) continue
      return { url: m[1], line: +m[2], col: +m[3], server: line.includes('about://React/Server/') }
    }
    return null
  }

  // ---- source maps: a frame in compiled code back to the file and line it was written at ----
  const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  function decodeMappings(mappings) {
    const lines = []
    let src = 0, ol = 0, oc = 0
    for (const lineText of mappings.split(';')) {
      const segs = []
      let gc = 0
      if (lineText) for (const seg of lineText.split(',')) {
        const v = []
        let shift = 0, val = 0
        for (const ch of seg) {
          const d = B64.indexOf(ch)
          val += (d & 31) << shift
          if (d & 32) shift += 5
          else { v.push(val & 1 ? -(val >> 1) : val >> 1); val = 0; shift = 0 }
        }
        gc += v[0]
        if (v.length > 3) { src += v[1]; ol += v[2]; oc += v[3]; segs.push([gc, src, ol]) }
      }
      lines.push(segs)
    }
    return lines
  }
  // a map, plain or in sections (turbopack), as a lookup of (line, col) to { source, line }
  function lookupFor(map) {
    if (map.sections) {
      const parts = map.sections.map(s => ({ line: s.offset.line, col: s.offset.column, find: lookupFor(s.map) }))
      return (l, c) => {
        let part = null
        for (const p of parts) if (p.line < l || (p.line === l && p.col <= c)) part = p
        return part ? part.find(l - part.line, part.line === l ? c - part.col : c) : null
      }
    }
    let lines = null
    return (l, c) => {
      lines = lines || decodeMappings(map.mappings || '')
      const segs = lines[l] || []
      let best = null
      for (const s of segs) { if (s[0] <= c) best = s; else break }
      if (!best && segs.length) best = segs[0]
      return best ? { source: map.sources[best[1]], line: best[2] + 1 } : null
    }
  }
  const maps = new Map()
  function mapFromText(text, base) {
    const m = text.match(/sourceMappingURL=(data:application\/json[^"'\s\\]+)/) || text.match(/[#@] sourceMappingURL=([^\s"'\\]+)\s*$/m)
    if (!m) return null
    const ref = m[1]
    const data = ref.match(/^data:application\/json;(?:charset=[^;,]+;)?base64,(.+)$/)
    if (data) return JSON.parse(decodeURIComponent(escape(atob(data[1]))))
    return fetch(new URL(ref, base)).then(r => (r.ok ? r.json() : null)).catch(() => null)
  }
  function mapFor(url) {
    if (maps.has(url)) return maps.get(url)
    let job
    if (url.startsWith('webpack-internal:///')) {
      // next with webpack: each module is evaluated with its own map, inside the chunk the page loaded
      const key = url.slice('webpack-internal:///'.length)
      let text = null
      for (const g of Object.keys(self).filter(k => k.startsWith('webpackChunk'))) {
        for (const c of self[g] || []) if (c && c[1] && c[1][key]) text = String(c[1][key])
      }
      job = Promise.resolve(text ? mapFromText(text, location.href) : null)
    } else if (/^https?:/.test(url)) {
      job = fetch(url).then(r => (r.ok ? r.text() : '')).then(t => mapFromText(t, url)).catch(() => null)
    } else job = Promise.resolve(null)
    job = job.then(m => (m ? lookupFor(m) : null)).catch(() => null)
    maps.set(url, job)
    return job
  }
  // a source path the way a person reads it: no bundler prefixes
  function cleanPath(p) {
    return String(p)
      .replace(/^webpack:\/\/[^/]*\/\.\//, '')
      .replace(/^webpack-internal:\/\/\/(\([^)]*\)\/)?\.\//, '')
      .replace(/^turbopack:\/\/\[project\]\//, '')
      .replace(/^\/@fs/, '')
      .replace(/^https?:\/\/[^/]+\//, '')
      .replace(/\?.*$/, '')
  }
  async function resolveFrame(f) {
    if (!f.server) {
      const find = await mapFor(f.url)
      const hit = find && find(f.line - 1, f.col - 1)
      if (hit && hit.source && !LIB.test(hit.source)) return `${cleanPath(hit.source)}:${hit.line}`
    }
    // no map here (a server component, or none served): the file alone. a compiled line number
    // would point at the wrong place; inspect.rb finds the line in the file itself
    return cleanPath(f.url.replace(/^webpack-internal:\/\/\/\([^)]*\)\//, 'webpack-internal:///'))
  }
  // a framework's own wrappers say nothing about the app: leave them out of the chain
  const INTERNAL = /^(SegmentViewNode|InnerLayoutRouter|OuterLayoutRouter|LayoutRouter|RenderFromTemplateContext|ScrollAndFocusHandler|InnerScrollAndFocusHandler|ClientPageRoot|ClientSegmentRoot|AppRouter|Router|ServerRoot|Root|HotReload|AppDevOverlay|ReactDevOverlay|DevRootHTTPAccessFallbackBoundary|ErrorBoundaryHandler|RenderedRoute|Routes|Outlet|Suspense|StrictMode|Fragment|Provider|Consumer|Anonymous|_c\d*|__next_\w+)$|(Boundary|Provider|Context)$/
  function nameOf(t) {
    if (!t) return null
    if (typeof t === 'function') return t.displayName || t.name || null
    if (typeof t === 'object') return t.displayName || (t.render && (t.render.displayName || t.render.name)) || (t.type ? nameOf(t.type) : null)
    return null
  }
  // react 18 says where an element was written; react 19 keeps the stack that created it
  function srcOf(fiber) {
    if (fiber._debugSource) return { file: fiber._debugSource.fileName, line: fiber._debugSource.lineNumber }
    const frame = fromStack(fiber._debugStack && fiber._debugStack.stack)
    return frame ? { frame } : null
  }
  function react(el) {
    const key = Object.keys(el).find(k => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'))
    if (!key) return null
    const fiber = el[key]
    const chain = []
    const add = name => {
      if (name && name.length <= 60 && !INTERNAL.test(name) && !chain.includes(name) && chain.length < 4) chain.push(name)
    }
    // react 19: the owner that wrote this element, server components included (as { name, env })
    for (let o = fiber._debugOwner, n = 0; o && n < 20 && chain.length < 4; o = o._debugOwner || o.owner, n++) {
      add(o.env ? o.name : nameOf(o.type))
    }
    // and the client components it sits in
    for (let f = fiber.return, n = 0; f && n < 80 && chain.length < 4; f = f.return, n++) {
      const t = f.type
      if (typeof t !== 'function' && !(t && typeof t === 'object' && (t.render || t.type))) continue
      add(nameOf(t))
    }
    return { comp: chain, src: srcOf(fiber) }
  }
  function vue(el) {
    const c = el.__vueParentComponent
    if (!c) return null
    const chain = []
    for (let x = c; x && chain.length < 4; x = x.parent) {
      const name = x.type && (x.type.__name || x.type.name)
      if (name && !chain.includes(name)) chain.push(name)
    }
    const file = c.type && c.type.__file
    return { comp: chain, src: file ? { file, line: 0 } : null }
  }
  function svelte(el) {
    const m = el.__svelte_meta
    if (!m || !m.loc) return null
    const file = m.loc.file
    const name = file ? file.split('/').pop().replace(/\.svelte$/, '') : null
    return { comp: name ? [name] : [], src: { file, line: m.loc.line } }
  }

  function short(el) {
    if (el.id && /^[A-Za-z][\w-]{0,40}$/.test(el.id)) return `#${el.id}`
    let s = el.tagName.toLowerCase()
    const cls = [...el.classList].filter(c => /^[A-Za-z][\w-]{0,30}$/.test(c) && !/^(css|sc|jsx|svelte)-/.test(c)).slice(0, 2)
    if (cls.length) s += '.' + cls.join('.')
    const parent = el.parentElement
    if (parent) {
      const same = [...parent.children].filter(c => c.tagName === el.tagName)
      if (same.length > 1) s += `:nth-of-type(${same.indexOf(el) + 1})`
    }
    return s
  }
  function selector(el) {
    const parts = []
    for (let x = el; x && x.nodeType === 1 && parts.length < 4; x = x.parentElement) {
      const s = short(x)
      parts.unshift(s)
      if (s.startsWith('#') || x === document.body) break
    }
    return parts.join(' > ')
  }
  function textOf(el) {
    const label = el.getAttribute('aria-label') || el.getAttribute('alt') || el.getAttribute('placeholder') || el.getAttribute('title')
    if (label) return label.trim().slice(0, 80)
    if (el.children.length > 4) return ''
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  }

  const out = []
  const pending = []
  const index = new Map()
  const all = document.body ? document.body.querySelectorAll('*') : []
  for (const el of all) {
    if (out.length >= MAX) break
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|LINK|META|BR|WBR)$/.test(el.tagName)) continue
    const r = el.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.right <= 0 || r.bottom <= 0 || r.left >= vw || r.top >= vh) continue
    if (el.checkVisibility && !el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })) continue
    let parent = -1
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (index.has(p)) { parent = index.get(p); break }
    }
    const info = react(el) || vue(el) || svelte(el)
    const item = {
      i: out.length,
      p: parent,
      tag: el.tagName.toLowerCase(),
      x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height),
      sel: selector(el),
      text: textOf(el),
    }
    if (info && info.comp && info.comp.length) item.comp = info.comp
    if (info && info.src && info.src.file) item.src = info.src.line ? `${info.src.file}:${info.src.line}` : info.src.file
    if (info && info.src && info.src.frame) pending.push([item, info.src.frame])
    // the element's own classes, so its line can be found in the source when no map gives it
    const cls = typeof el.className === 'string' ? el.className.trim() : ''
    if (cls) item.cls = cls.slice(0, 200)
    const testid = el.getAttribute('data-testid') || el.getAttribute('data-test') || el.getAttribute('data-cy')
    if (testid) item.testid = testid.slice(0, 60)
    const role = el.getAttribute('role')
    if (role) item.role = role.slice(0, 30)
    if (el.tagName === 'A' && el.getAttribute('href')) item.href = el.getAttribute('href').slice(0, 120)
    index.set(el, item.i)
    out.push(item)
  }
  // map every frame back to its source, each module's map read once, within 4 seconds
  const seen = new Map()
  const work = Promise.all(pending.map(async ([item, f]) => {
    const k = `${f.url}:${f.line}:${f.col}`
    if (!seen.has(k)) seen.set(k, resolveFrame(f))
    item.src = await seen.get(k)
  }))
  await Promise.race([work, new Promise(r => setTimeout(r, 4000))])
  return {
    url: location.href,
    title: document.title,
    vw, vh,
    dpr: window.devicePixelRatio || 1,
    name: window.name,
    hasComponents: out.some(e => e.comp),
    elements: out,
  }
})()
