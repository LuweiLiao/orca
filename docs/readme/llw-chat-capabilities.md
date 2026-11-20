# Conversation Skills, MCP and Timeline

The conversation sidebar has three folding groups, Skill, MCP and the timeline
of the user's messages, under one search field. Each group's heading stays in
view while its rows scroll. Timeline navigation reuses the transcript rail's
history loading and jump logic. The sidebar can be closed; a narrow chat shows
it over the transcript.

Structured Claude and Codex conversations show the same rows: a compact switch,
the recorded call count, and Use this turn, which appears on hover and inserts
the existing skill chip in the draft, including its file when known. Enable all
and Disable all live in the header's menu and leave locked entries alone.
Terminal-backed conversations and older hosts show the same list without
switches.

The default selection leaves provider configuration unchanged. Explicit choices
are saved with the conversation as `chatCapabilities` and captured in each
accepted message's execution options, including queued messages. They are not
written to the provider's user or project configuration.

Changed choices wait for existing work to settle. Before the next message, the
host resumes the conversation in a replacement process launched with the
selection. The existing process is kept when its selection matches. This uses
the same retirement path as a changed permission mode and preserves background
work that has not settled.

## Claude

The replacement Claude process carries `skillOverrides` and `deniedMcpServers`
in its SDK launch settings.

An isolated probe with Claude Code 2.1.300 and SDK 0.3.284 showed that
`applyFlagSettings` changes the reported MCP denylist while an already connected
server and its tool definition remain available. Applying the denylist at launch
removed the server and its tools. Relevant settings fields remained unchanged on
disk. The probe sent no model request. This is why the implementation restarts
at the next idle send instead of claiming that a live denylist disconnects MCP.

An explicit `--settings` file cannot currently be combined with a restricted
conversation selection: the start reports that conflict instead of silently
leaving the requested tools available. Enabling all removes this restriction.

## Codex

The replacement app-server thread is opened (`thread/start` or `thread/resume`)
with thread-scoped `config` overrides: `mcp_servers.<name>.enabled = false` for
each disabled server, and `skills.config` entries `{ path, enabled: false }` for
each disabled skill. `skills.config` replaces Codex's list, so the entries the
user already has in `config.toml` are read with `config/read` and kept.

Only servers that `config.toml` defines can be switched. Naming a plugin's
server, or one removed from the configuration, makes Codex 0.165 refuse to open
the thread (`invalid transport`), so such names are never sent. Plugin servers
are listed as locked, as are servers disabled in `config.toml` and names
containing a dot, which the override key cannot address. The server list comes
from `config/read` and the thread's `mcpServer/startupStatus/updated` reports;
`mcpServerStatus/list` was not used because it returned about 800 KB and took
11 to 13 seconds against this machine's configuration.

When Codex cannot report its configuration or skills, a start with a restricted
selection is refused rather than leaving the tools loaded.

Probes on November 5, 2026 against Codex CLI 0.165.0, using a local fake model
endpoint so no model request left the machine, confirmed: a disabled server
reads `disabled` with no tools on a new and on a resumed thread; a disabled
skill is absent from the skill catalog of a new thread, by name or by path; and
a resumed thread sends a new catalog without it. The earlier catalog stays in
the resumed thread's history, so the model can still see that skill's earlier
description.

Call counts cover loaded messages, deduplicated by provider call ID. They do not
claim a whole-history inventory or infer Skill use from an ordinary file read.

## Validation

November 5, 2026, initial Claude version: the main typecheck projects, 151
focused tests, 12 focused child-retirement tests, generated RPC contract
verification, changed-source quality checks, and a background Electron journey
exercising usage display, 30 timeline messages, navigation, folding, narrow
layout and light/dark rendering.

November 5, 2026, Codex switches and sidebar redesign: node and web typechecks,
oxlint and oxfmt on the changed files, the Codex capability tests, the Codex
adapter and agent-session-wire suites (the same pre-existing Windows failures
before and after), the sidebar component test, and the two message-rail
Electron journeys in a background window. The switch rows were rendered in
light and dark with sample data injected into a temporary e2e build; no real
Claude or Codex conversation was run, and no installer was produced. The
changed-code quality script fails on Windows with `ENAMETOOLONG` before
checking anything, so it is not reported as passing.
