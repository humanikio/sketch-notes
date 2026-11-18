# sketch-notes

`/sketch` opens a full-screen board in Claude Code for your running local apps, window screenshots and images. Click anything to say what should change, and attach it all to your prompt: a png of the board, a crop of each page, and a written list of every note, naming the component, source file and line under each one. A skill in the same plugin tells Claude how to read a sketch, and when to suggest drawing one.

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install sketch-notes --marketplace humanikio/sketch-notes
```

Answer `y` to add the marketplace if asked, then pick a scope.

## Needs

- `ruby` on your PATH (macOS ships one)
- Google Chrome, Brave, Edge or Chromium, for live pages whose components can be read (any browser opens the board otherwise)
- macOS for the 📸 Screenshot tab, with Screen Recording allowed for the app you run Claude Code in
- macOS's `sips` (built in) or ImageMagick's `magick`, for HEIC and TIFF images
- for `/sketch pane` only: a terminal that reports the mouse (kitty, Ghostty, iTerm2, WezTerm and foot draw the smoothest lines)

## Use: the board (default)

`/sketch` opens the sketch board full screen: an infinite canvas that opens in a separate Chrome profile (the *inspect profile*, kept in `~/.claude/sketch-notes/inspect-profile`, with its DevTools port open on `127.0.0.1`) so the live pages on it can be read. Without a Chrome-family browser it opens in your default browser, and pages are still live but their components can't be read. `/sketch path/to/image.png` adds that image to the board.

- **Click means comment.** A plain click anywhere asks **"What should be changed here?"**. On a live page it pins the note to the component under the mouse (hover to see it outlined with its name and source), on an image to that spot of it, elsewhere to the board. ✓ or Enter keeps the note, ✕ or Esc closes it, 🗑 deletes it. ⌥-click pins to the exact spot instead of a component.
- **Drawing is opt-in**, from the palette on the left: pen `P`, highlighter `H`, arrow `A` (⇧ snaps the angle), box `B` (⇧ squares it), eraser `E` (deletes whole drawings). `V` or Esc goes back to the default cursor. Colors `1`–`6` or the custom picker, width `[` `]`, opacity. With drawings selected, the palette restyles them.
- **Select like a design tool.** Drag on empty board to select everything the box touches (⇧ adds), drag to move, handles to resize, and a toolbar over the selection: Copy, Duplicate, ↑ ↓ (order), Delete. ⌘C ⌘X ⌘V ⌘D ⌘A, Delete, arrows nudge (⇧ by 10, ⌥ resizes), ⌘Z ⇧⌘Z. Pasted copies are offset so none sits on another.
- **＋ Page** (`W`) puts a live page of a local server on the board: pick one of the dev servers running on your Mac, or type a URL, and a size (desktop, laptop, tablet, mobile). Each page has a title bar to move it, ⟳ reload, its size, and **Comment / Interact**: in Interact your clicks and typing go to the page, so you can get it to the state you want; in Comment they pin notes. Pages are lettered A, B, … and can sit side by side.
  - A page that refuses to be framed is marked with a red dot and a **Use snapshot** button, which puts a captured picture of it in its place, its components kept.
- **📸 Screenshot** (`S`) adds any window on screen; **🖼 Image** (`O`), dropping or pasting adds images. New things land in a clear spot, at most 60% of the view, never full screen.
- **Pan** with Space+drag, a two-finger scroll or the middle button; **zoom** with pinch, ⌘ scroll, ⌘+ ⌘− ⌘0; **⇧1** fits everything, **⇧2** the selection.
- **Attach to prompt** (⌘↵) attaches the selection if there is one, else the whole board: one png of it, with live pages as they look right then, plus a readable crop of each page the overview shows small. Your prompt box gets:

```
@/Users/you/.claude/sketches/sketch-2026-11-17T10-02-11.png tidy up the pricing flow
pages on the sketch:
  A. http://localhost:5173/pricing (Pricing) @/Users/you/.claude/sketches/sketch-2026-11-17T10-02-11-page-A.png
notes pinned on the sketch (numbered on the image):
1. A · <BuyButton> (in PricingCard ‹ PricingPage) · button[data-testid="buy-Pro"] "Buy Pro" · src/components/BuyButton.tsx:12 · selector: #root > main > div.card:nth-of-type(1) > button.primary: make this purple
2. A · bottom center: more space below the cards
```

- **The board is kept** in `.claude/sketches/board/` and comes back the next time you run `/sketch`. **⋯ › New board** starts fresh and keeps the old one beside it.

Component names come from React, Vue or Svelte; source files and lines from dev builds (Vite, Next and similar keep them; a production build gives names and selectors only).

The board is served by `scripts/window.rb` on `127.0.0.1` behind a one-time token. The DevTools connection is made by `scripts/inspect.rb` alone, and Chrome only accepts connections to that port that send no `Origin` header, so web pages can't use it. While the inspect profile is open, other programs on your Mac could connect to it, so close its windows when you're done.

## Use: the terminal pane

`/sketch pane` (or the `opens` setting set to `pane`) draws in the terminal instead. The pane's **⤢ full screen** button (`f`) moves to the window, bringing the image along.

1. Run `/sketch pane`. To start from an image, run `/sketch path/to/image.png`, or type `/sketch` and drop or paste an image into the prompt box before pressing Enter.
2. Drag with the left button to draw. Right-click undoes the last line.
3. Press **attach to prompt** (`a`). The png goes to `~/.claude/sketches/` and `@.claude/sketches/sketch-<time>.png` lands in your prompt box. Type the rest of your question and send.

Keys in the pane, once the pane has the keyboard (a click on the canvas gives it to the canvas; Esc gives it back):

| Key | Does |
|---|---|
| `1`–`6` | ink: black, red, blue, green, orange, white |
| `e` | eraser (brings back the image under it) |
| `s` `l` | smaller, larger brush |
| `u` | undo (after a clear, brings the drawing back) |
| `c` | clear the drawing, keeping the image |
| `o` | open an image: browse folders from the project, desktop or downloads |
| `p` | drop or paste a path: drop a file on the terminal window, press Enter |
| `b` | remove the image |
| `a` | attach to prompt |
| `x`, Esc | close |

While the canvas has the keyboard, `u` or ctrl+z undoes.

The drawing stays when you close the pane, so you can reopen it, change it and attach again.

## Settings

| Setting | Default | What it is |
|---|---|---|
| `opens` | `window` | `window`, the full-screen canvas, or `pane`, the canvas in the terminal |
| `folder` | `~/.claude/sketches` | where attached sketches and the board are kept: outside every project by default, so they are never committed. A relative path is taken from the folder Claude Code runs in |

Set it in `/config` (the sketch-notes row), or with `claude plugin configure sketch-notes@sketch-notes`. If that folder is inside a git repo you push, add it to `.gitignore`.

## The script

`scripts/sketch.rb` does the image work, so the pane never decodes or encodes a picture itself:

```
ruby scripts/sketch.rb --check IMAGE          # can it be read, and how big is it
ruby scripts/sketch.rb --grid IMAGE W H       # the image fitted to the canvas, as small hex pixels for the pane
ruby scripts/sketch.rb --export OUT < JSON    # draw the strokes over the image (or white) and write OUT as a png
ruby scripts/sketch.rb --save-b64 OUT < B64   # write an image pasted into the prompt box to a file
```

The png is 1600 pixels on its long side, with the image fitted whole inside the canvas and the strokes drawn over it at that size.

## The skill

`skills/read-sketches` is Markdown only. When a prompt carries a sketch, Claude looks at it first, reads rough shapes for intent (a circle singles something out, an arrow points, a cross removes), names what each mark points at, and follows the note list to the files and lines. When you are struggling to say where something is or how parts connect, Claude suggests `/sketch` once.

## What it runs and sends

### Programs it runs, and why

| Program | When | What for |
|---|---|---|
| `ruby scripts/window.rb` | each `/sketch` (the board) | serves the board on a random port of `127.0.0.1` behind a one-time token, keeps the board in `<folder>/board/`, writes the png on attach, then exits (after attach, cancel, a closed window, or 4 idle hours) |
| Chrome, Brave, Edge or Chromium | each `/sketch` | opens the board as an app window of a separate profile, `~/.claude/sketch-notes/inspect-profile`, started with `--remote-debugging-port` on `127.0.0.1`; falls back to your default browser |
| `lsof` | opening the server list; capturing a page | lists the local servers listening (node, bun, python, ruby, …), and finds the folder a page's dev server runs in |
| `osascript` and `screencapture` (macOS) | the 📸 Screenshot tab | lists the windows on screen and captures the one you pick |
| `sips` or `magick` | an image the browser cannot show (HEIC, TIFF) | converts it to png in a temporary folder, deleted after |
| `open` | opening the board; the Screen Recording settings button | opens the browser, or that System Settings page |
| `grep` | capturing a page whose components the browser cannot place in a file | looks for where a component is defined in that dev server's project |
| `ruby scripts/sketch.rb` | `/sketch pane` (the terminal canvas) | reads images and writes the png for the terminal pane |
| `/bin/sh -c 'printf %s "$HOME"'` | session start | your home folder, for `~` in paths |

### What it reads

- **The pages you put on the board.** In the inspect profile, `scripts/inspect.rb` connects to Chrome's DevTools port and runs `scripts/inspect.js` in each page: the visible elements, their positions, short selectors and text, and the React, Vue or Svelte component that drew each one. Only the pages on your board are read, only when you hover, pin a note or attach.
- **Source maps** those pages already loaded, to turn a compiled line into the file and line you wrote.
- **Your project's source files**, for a page from a dev server on this Mac when the browser cannot give a line (server components): the file the component is in, to find the element's line by its text or classes. Nothing is written to your project.
- **Each local server's home page `<title>`**, to label the server list.

### What it sends, and where

- **Nothing leaves your machine from this plugin.** No telemetry, no server of its own. The board, its DevTools connection and every request above stay on `127.0.0.1`.
- **The pages on your board load as they would in Chrome**, from wherever their URL points: your local servers, or a site you typed.
- **The png and the prompt text reach Claude only when you send the prompt**, the same way any `@` file you mention does.

### Safety

- The board answers only requests that carry its one-time token, from its own page.
- The DevTools connection is made by `scripts/inspect.rb` alone. Chrome only accepts connections to that port that send no `Origin` header, so web pages can't use it. While the inspect profile is open, other programs on your Mac could connect to it, so close its windows when you're done.

### What each hook does

- **`session.start`**: registers the `/sketch` command and notes the working folder and home folder.
- **`command.run`** (for `/sketch`): starts the board (or, with `pane`, opens the terminal canvas), with the image named after the command, if any.
- **`prompt.submit`**: for `/sketch` with an image pasted or dropped into the prompt box, saves the image and opens it on the board. For any other prompt that mentions a sketch this session attached, adds a short note for the model about what the sketch holds. Other prompts pass through untouched.
- **`ui.message`** and **`ui.render`**: the terminal pane (`/sketch pane`): its toolbar, canvas (`hooks/canvas.tsx`) and file browser.
