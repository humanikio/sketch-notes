# Sketch canvas v2: spec

Status: built (milestones 1–3) · 2026-11-17
Scope: `plugins/sketch-notes-pane/scripts/window.html` (rewritten), `window.rb` and `inspect.rb` (extended), `hooks/register.tsx` (attach output)

## 1. Why

The sketch window today is a single raster drawing over one background image. That makes it hard to:

- remove or move what was drawn (it's baked in; only undo or the eraser)
- put more than one screenshot or page side by side
- work on a running app without capturing it first in a separate window
- say "change this" quickly: you have to pick the Note tool first, and the default is the pen

v2 turns the window into a **board**: an infinite, zoomable canvas of objects you can select, move, copy, paste and delete, with live pages of your local servers on it. The first thing a click does is ask **"What should be changed here?"**

## 2. Principles

1. **Click means comment.** A plain click anywhere opens a note asking "What should be changed here?". On a page it pins to the component under the cursor; elsewhere it pins to the spot.
2. **Drawing is opt-in.** Pen, highlighter, arrow, box and eraser draw only while picked from the palette. Esc or `V` goes back to the default cursor.
3. **Everything is an object.** Strokes, shapes, notes, images and pages can all be selected, moved, copied, pasted and deleted.
4. **Behave like a design tool.** Selection, the toolbar above the selection, the shortcuts and paste offsets work the way they do in tools like Figma.
5. **One window.** Pages, screenshots, drawing and notes all live in the sketch window. No second inspect window to manage.

## 3. Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│ Sketch            ⟲ ⟳         100% ▾          + Page   📸   🖼   ⤢    │  top bar
├──────┬────────────────────────────────────────────────────────────────┤
│ ↖ V  │                                                                │
│ ✎ P  │   ┌ localhost:3002/pricing ─ ⟳ ◉Comment ○Interact ┐  ┌ shot ┐  │
│ ▮ H  │   │                                               │  │      │  │
│ ↗ A  │   │    [ live page ]        (2)● ── note          │  └──────┘  │
│ ▢ B  │   │                                               │            │
│ ⌫ E  │   └───────────────────────────────────────────────┘            │
│ ──── │                                                                │
│ ● ●  │          board: pan with Space+drag or trackpad,               │
│ ● ●  │          zoom with ⌘± or pinch                                 │
│ ━━ ▾ │                                                                │
│ ◐ ▾  │                                                                │
├──────┴────────────────────────────────────────────────────────────────┤
│ [ What is this about? (optional) ...........................]  Cancel  Attach ⌘↵ │
└───────────────────────────────────────────────────────────────────────┘
```

- **Left panel (palette)**, fixed, about 64px wide:
  - Tools: Select/comment `V` (the default), Pen `P`, Highlighter `H`, Arrow `A`, Box `B`, Eraser `E`
  - Properties: color swatches (6 plus a custom picker), stroke width, opacity
  - With a selection, the properties edit the selection: recolor 5 arrows at once. With none, they set the style for the next thing drawn.
- **Top bar:** undo and redo, zoom menu (Fit all, 100%, Zoom to selection), **+ Page** (add a local server or URL), **📸 Screenshot** (pick a window), **🖼 Image** (from a file), Full screen.
- **Bottom bar:** as today. A prompt field, Cancel, Attach.

## 4. The default cursor: comment and select (`V`)

| You do | Over | Result |
|---|---|---|
| click | empty board | note at that spot: "What should be changed here?" |
| click | a screenshot or image | note pinned to that spot of the image |
| click | a page in Comment mode | note pinned to the **component** under the cursor (outlined on hover) |
| ⌥ click | a page | note on the exact spot, not a component |
| click | a stroke, shape or note pin | selects it (a note pin opens its note) |
| shift click | anything | adds it to the selection, or removes it |
| drag | empty board | **selection box**: on release, every object it touches is selected (shift adds) |
| drag | a selected object, or a screenshot or image body | moves it (all selected objects move together) |
| drag | a page's title bar | moves the page |
| drag | a selection handle | resizes (shift keeps the aspect ratio) |
| hover | a page in Comment mode | outlines the component, with its name, size and source file |

A movement under 4px counts as a click, not a drag.

### The note box

- Opens at the click with the placeholder **"What should be changed here?"**
- Its header names the target: `Note 3 · PricingCard › button "Buy Pro"`, or `Note 3 · screenshot, top left`
- For a component note: the source `file:line`, and a breadcrumb to move the note up to a parent component (as today)
- **✓** or Enter keeps it, **✕** or Esc closes it (a new empty note disappears), **🗑** deletes it (existing notes only)
- A kept note is a numbered pin. A component note also draws a dashed outline around its component.

## 5. Drawing tools (opt-in)

Picked from the palette or by key. They stay active until Esc or `V`.

- **Pen** `P`: freehand, smoothed, with pen pressure. Each stroke is one object.
- **Highlighter** `H`: wide, translucent, one object per stroke.
- **Arrow** `A`, **Box** `B`: drag to draw. Shift snaps the angle (arrow) or makes a square (box).
- **Eraser** `E`: drag across strokes and shapes to **delete those objects** (object eraser, not pixels). Images and pages are never erased; select and Delete them instead.

After a shape is drawn the tool stays on, so you can draw several. Esc returns to `V`.

## 6. Selection, clipboard and shortcuts

- A **selection toolbar** floats above the selection's bounding box (below it when there's no room): **Copy · Duplicate · Delete**, plus **Bring forward / Send back**.
- Shortcuts while not typing:

| Key | Action |
|---|---|
| ⌘C / ⌘X / ⌘V | copy, cut, paste |
| ⌘D | duplicate |
| ⌘A | select all |
| Delete, Backspace | delete the selection |
| arrows | nudge 1px (shift: 10px) |
| ⌥ arrows | resize from the right and bottom edges |
| ⌘Z / ⇧⌘Z | undo, redo (every change above is undoable) |
| Esc | clear the selection, or leave a drawing tool |

- **Clipboard:** objects are copied to `sessionStorage` (`sketch.clipboard.v1`) and also as an image on the system clipboard.
- **Paste:**
  - objects from the sketch clipboard land at the same place, offset in 16px steps until no copy sits exactly on top of an existing object
  - an image on the system clipboard becomes a new **image object** at the center of the view
  - text on the system clipboard becomes a free note
- **Drag and drop:** dropping image files adds image objects where they're dropped. Several files are laid out in a row.

## 7. Board and viewport

- An infinite board with a dot grid, pan (Space+drag, trackpad, middle mouse) and zoom (⌘+ ⌘− ⌘0, pinch, ⌘ scroll), from 10% to 400%.
- **Fit all** (`⇧1`) and **Zoom to selection** (`⇧2`), as in Figma.
- New screenshots and images are placed **at the center of the view, scaled to fit at most 60% of it**, never filling the board. They keep full resolution for export.

## 8. Objects

```
Stroke  { id, kind: 'pen'|'hl', points[[x,y,p]], color, width, opacity }
Shape   { id, kind: 'arrow'|'box', a:[x,y], b:[x,y], color, width, opacity }
Image   { id, kind: 'image', x, y, w, h, src (blob url), name, natural:{w,h}, page?: Capture }
Page    { id, kind: 'page', x, y, w, h, url, title, mode:'comment'|'interact', viewport:{w,h} }
Note    { id, kind: 'note', n, text, anchor: Spot | Component }
  Spot      { x, y, on?: imageId }               // on an image it moves with it
  Component { on: pageId|imageId, el: Element }  // el: tag, comp[], src, sel, text, testid, rect
```

All coordinates are in board space. Objects are drawn in z order. Notes always sit on top.

## 9. Pages: live local servers on the board

- **+ Page** opens a small picker:
  - **dev servers running on this Mac** (from `lsof`, as now), each as a chip
  - a URL field, with history
  - the page size: Desktop 1440×900 (default), Laptop 1280×800, Tablet 834×1112, Mobile 390×844
- A page is a framed **iframe** of the live site. Its title bar has the URL, ⟳ reload, a **Comment ◉ / Interact ○** switch and a size menu.
  - **Comment** (default): the page doesn't receive clicks. Hover outlines components, click pins a note to one.
  - **Interact**: clicks, typing and scrolling go to the page, so you can navigate to the state you want, then switch back.
- Several pages can sit side by side, e.g. `/pricing` next to `/checkout`. You can draw arrows between them.
- **How components are read:**
  - the sketch window itself opens in the inspect Chrome profile (its DevTools port on 127.0.0.1)
  - `inspect.rb` attaches to each page's iframe as its own target and runs `inspect.js` there: elements, component chain, source `file:line`
  - this is refreshed on hover after the page changes (navigation, DOM mutation, debounced at 500ms)
- **Falls back to a screenshot** when a site refuses to be framed (X-Frame-Options or CSP frame-ancestors): `inspect.rb` opens it in a background tab of the same profile, captures it with its elements, and places it as an Image with a `page` capture. Notes on components work the same. The title bar says "snapshot", with a ⟳ to take it again.
- **Screenshot** (📸) of any Mac window works as today but drops an Image object on the board.

## 10. Attach (decisions, change if you disagree)

- **What gets exported:** the selection's bounding box if anything is selected, else **everything on the board**, cropped to the content with 32px padding.
- **Live pages:** each page is snapshotted (`Page.captureScreenshot` of its iframe target) at the moment you attach, so the PNG shows what you saw.
- **Output:**
  - one PNG: `.claude/sketches/sketch-<time>.png`, at up to 2400px on its long side, plus up to 4 page crops (`…-page-<n>.png`) when the board holds pages and the overview would make them too small to read
  - **prompt text:**

```
@.claude/sketches/sketch-2026-11-14T16-02-11.png make checkout match pricing
pages on the sketch:
  A. http://localhost:3002/pricing (Pricing)
  B. http://localhost:3002/checkout (Checkout)
notes pinned on the sketch (numbered on the image):
1. A · <BuyButton> (in PricingCard ‹ PricingPage) · button "Buy Pro" · src/components/BuyButton.tsx:12 · selector: …: make this purple
2. B · top right of the page: the summary should stick on scroll
3. board: arrow from A to B: same header on both
```

- An empty board can't be attached ("add a note, a drawing or a page first").

## 11. Saving the board (decision)

- The board autosaves to `.claude/sketches/board.json` in the working folder (objects plus image files beside it), debounced at 1s.
- `/sketch` reopens the last board. **New board** in the top bar menu starts fresh, and the previous one is kept as `board-<time>.json`.
- `/sketch <image>` adds the image to the current board.

## 12. Architecture

- **As built:** `window.html` is the shell; `scripts/canvas/app.js` (one ES module, in sections: model, undo, render, pages, overlay, pointer, notes, palette, clipboard, images, export) and `scripts/canvas/board.css` are served by `window.rb` from `/static/`. No build step and no dependencies.
- **Rendering:**
  - canvas 2D for the board, strokes, shapes and images
  - DOM for pages (iframes), notes, handles and toolbars, positioned with one CSS transform per viewport change
- **Hit testing:** on the default tool, in this order: note pins, selected-object handles, strokes and shapes (distance to path ≤ width/2 + 4px at the current zoom), images, page title bars, page body (component lookup), empty board.
- **Undo:** a command stack (add, remove, move, resize, restyle, edit note), 200 deep.
- **window.rb / inspect.rb additions:**
  - open the sketch window in the inspect profile (falling back to an app window of the normal browser, with live pages then limited to the snapshot path)
  - `GET /pages/frames`: iframe targets for the open pages
  - `POST /pages/inspect?frame=`: elements of one page's iframe
  - `POST /pages/snapshot?frame=`: PNG of one page
  - `GET|PUT /board`: load and save `board.json` and its images
- **register.tsx:** formats pages (A, B, …), notes with their page letter, and board-level notes. Otherwise unchanged.

## 13. Out of scope for v2

- Multiplayer, comments threads, or sharing a board
- Text objects other than notes (labels are notes)
- Inspecting pages in your normal signed-in Chrome profile (that would be the extension approach)
- Pages of non-local sites that need sign-in. They work if you sign in inside the inspect profile, but this is not tuned for it.

## 14. Milestones

1. **Board and selection:** object model, viewport (pan, zoom, fit), left palette, default comment-and-select tool, the "What should be changed here?" note, marquee, move, resize, selection toolbar, copy, cut, paste, duplicate, delete, undo. Images and screenshots as objects. Attach exports the selection or the whole board.
2. **Live pages:** + Page picker, iframes with Comment and Interact modes, component hover and notes through the inspect profile, snapshot fallback, page letters in the prompt.
3. **Persistence and polish:** board autosave and reopen, page sizes, page crops on export, history in the URL field.

Each milestone ships on its own and is tried before the next.

## 15. Acceptance checks

- A plain click on an empty board opens "What should be changed here?". No ink is ever drawn without a drawing tool picked.
- Drag on empty board, release, Delete: everything in the box is gone. ⌘Z brings it back.
- ⌘C ⌘V twice: two copies, each offset, none exactly on top of another.
- Pasting a screenshot (⌘V) adds an image at about 60% of the view, movable and resizable. It doesn't replace anything.
- A Vite or Next page from `localhost` opens as a page. Hovering shows component names and source lines. A click pins a note that names them in the prompt.
- Interact mode lets you click through the app. Comment mode never sends clicks to it.
- Two pages and an arrow between them export as one PNG with both pages as they looked at attach time.
- Closing and reopening `/sketch` brings back the board (milestone 3).
