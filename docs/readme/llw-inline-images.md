# Inline Images And Agent Commands

Orca previews successful image reads, writes and image paths returned by tools.
Image paths and ordinary image-file links in assistant replies also get a preview;
the agent does not have to write image Markdown. Existing workspace and runtime
ownership decides which host supplies the bytes. Assistant result images use a
large preview with the existing full-size viewer on click.

The full-size viewer has previous/next buttons and Left/Right arrow shortcuts.
It follows image order across the currently loaded conversation, including image
attachments, successful tool outputs, Markdown images and automatic image-path
previews. Images in rows outside the rendered scroll window remain reachable.
The viewer reads each selected image through the conversation's existing runtime
owner, fits it to the screen on every change, and retains copy/file actions.
The first and last images disable the corresponding button; a single image has
no navigation buttons. Switching away from the chat closes its viewer.

## Agent CLI

```sh
orca image show /home/ubuntu/project/figs/result.png --title "Result" --json
orca image status <returned-id> --json
```

`show` defaults to `ORCA_AGENT_SESSION_ID`, so an agent publishes to its own
structured conversation. Outside an agent process, supply `--session <Orca-id>`.
Windows, macOS and Linux CLI calls resolve relative paths against their cwd.
A paired invocation leaves paths on the selected server; that server resolves
relative paths against the conversation's launch directory. The command never
opens a file tab, focuses a window, or starts a model turn.

An optional `--id <request-id>` makes a retried publication idempotent. Reusing
an id with another file is rejected. Image publication and renderer receipts are
stored in the conversation journal and survive a restart.

## RPC

The host advertises `agent-session.image-display.v1`. Older hosts return
`method_not_found`; image Markdown remains available on their existing surface.

```json
{
  "method": "agentSession.showImage",
  "params": {
    "sessionId": "claude_<Orca-id>",
    "id": "plot-1",
    "path": "/home/ubuntu/project/figs/result.png",
    "alt": "Result"
  }
}
```

`agentSession.imageStatus` takes `{ "sessionId": "...", "id": "plot-1" }`.
Both return `{ "sessionId", "id", "path", "itemId", "state" }`.

- `pending`: the host published the image; no viewer has reported successful decoding.
- `loaded`: an Orca viewer loaded the image bytes. This does not prove the person looked at it.
- `failed`: a viewer reported image decoding failure. A subsequent successful load may replace it.

`agentSession.imageRendered` is the viewer receipt endpoint. It accepts the same
session/id pair and `state: "loaded" | "failed"`. A later failure from another
viewer does not erase a prior successful load. Clients that do not implement
receipts leave images pending; a headless host with no viewer does too.

Claude and Codex receive a short capability description with the command syntax
at process startup. Automatic preview and explicit publication remain code paths,
independent of whether a model follows that description. A running provider
process needs a new launch to receive changed startup instructions.
