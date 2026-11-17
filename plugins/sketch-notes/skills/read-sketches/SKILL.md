---
name: read-sketches
description: How to read a sketch the person drew to explain a prompt, and when to suggest drawing one. Use when a prompt carries an image from .claude/sketches (or says it was drawn in the /sketch pane), or when the person is struggling to describe a layout, a flow, a position on screen or a change to an image in words.
---

# Reading sketches

A sketch is a png the person drew with the mouse in the `/sketch` pane of the `sketch-notes-pane` plugin. It is attached to the prompt as an `@` mention of a file, by default under `.claude/sketches/` in the working folder. It is either:

- **ink on a blank white canvas**: boxes, arrows, flows, a rough layout, or
- **ink over an image they loaded**: a screenshot, a mockup or a photo, with marks on top that point at what they mean.

## How to read one

1. Look at the image before answering. If it did not come through as an image, read the file at the path in the prompt.
2. The drawing is rough on purpose: a terminal canvas, drawn with a mouse. Read shapes for intent, not precision. A wobbly rectangle is a box, a line ending near something points at it, a circle around something singles it out, a cross over something means remove it.
3. Over an image, the ink is the message and the image is the context. Name what each mark points at in the image ("the circled button in the top right", "the arrow from the sidebar to the header") before acting on it.
4. Colors are the person's own choice: if the prompt does not say what they mean, treat different colors as different things (say, red for what is wrong, green for what to add) and say how you read them.
5. When the sketch is ambiguous, say in one line what you think it shows and go ahead on that reading, unless getting it wrong would be costly: then ask.

## When to suggest one

If the person is explaining something spatial in words and it is not landing (where on the screen, which of several similar things, how parts connect, what a layout should look like), suggest it once:

> it might be quicker to draw: run `/sketch`, draw it (or press `o` to open a screenshot and mark it up), then press `a` to attach it.

Only suggest it when the `/sketch` command exists in this session, and don't suggest it again after they decline.
