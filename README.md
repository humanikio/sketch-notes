# sketch-notes

Show Claude what you mean. `/sketch` opens a full-screen board where you put your running local apps, screenshots and images side by side, click anything to say **what should be changed here**, and attach it all to your prompt. A note on a live page names the component, its source file and line, and a selector, so Claude goes straight to the code.

This repo is a Claude Code marketplace with two plugins:

| Plugin | What it is |
|---|---|
| [`sketch-notes-pane`](plugins/sketch-notes-pane) | the `/sketch` board: live pages of your local dev servers (React, Vue and Svelte components read from the page), window screenshots, images, notes pinned to components or spots, drawing tools, and attach to prompt as a png plus a written list |
| [`sketch-notes`](plugins/sketch-notes) | the skill, in Markdown only: how Claude reads a sketch, and when to suggest drawing one. No hooks, no scripts. |

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install sketch-notes-pane --marketplace humanikio/sketch-notes
/plugin install sketch-notes --marketplace humanikio/sketch-notes
```

Answer `y` to add the marketplace, then pick a scope. The second line is optional.

From a shell: `claude plugin install sketch-notes-pane --marketplace humanikio/sketch-notes`

## Needs

`ruby` (macOS ships one) and, for live pages whose components can be read, Google Chrome, Brave, Edge or Chromium. Screenshots of windows are macOS only. See the [board's README](plugins/sketch-notes-pane/README.md) for everything it runs and reads.

## License

MIT
