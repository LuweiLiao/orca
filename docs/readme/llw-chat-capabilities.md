# Conversation Skills, MCP and Timeline

The conversation sidebar lists Skill and MCP entries separately and provides a
search field, recorded call counts, and a timeline of the user's messages.
Timeline navigation reuses the transcript rail's history loading and jump logic.
The sidebar can be folded; a narrow chat shows it over the transcript.

Claude structured conversations support individual switches, Enable all,
Disable all, and Use this turn. Use this turn inserts the existing skill chip in
the draft, including its file when known. Other providers and terminal-backed
conversations show the available information without offering session switches.

The default selection leaves provider configuration unchanged. Explicit choices
are saved with the conversation as `chatCapabilities` and captured in each
accepted message's execution options, including queued messages. They are not
written to the provider's user or project configuration.

Changed choices wait for existing work to settle. Before the next message, the
host resumes the conversation in a replacement Claude process whose SDK launch
settings carry `skillOverrides` and `deniedMcpServers`. The existing process is
kept when its selection matches. This uses the same retirement path as a changed
permission mode and preserves background work that has not settled.

An isolated probe with Claude Code 2.1.300 and SDK 0.3.284 showed that
`applyFlagSettings` changes the reported MCP denylist while an already connected
server and its tool definition remain available. Applying the denylist at launch
removed the server and its tools. Relevant settings fields remained unchanged on
disk. The probe sent no model request. This is why the implementation restarts
at the next idle send instead of claiming that a live denylist disconnects MCP.

An explicit `--settings` file cannot currently be combined with a restricted
conversation selection: the start reports that conflict instead of silently
leaving the requested tools available. Enabling all removes this restriction.

Call counts cover loaded messages, deduplicated by provider call ID. They do not
claim a whole-history inventory or infer Skill use from an ordinary file read.
Older hosts omit the optional capability report, leaving the controls read-only.

Validation on November 5, 2026 included the main typecheck projects, 151 focused
tests, 12 focused child-retirement tests, generated RPC contract verification,
and changed-source quality checks. A background Electron journey exercised
usage display, 30 timeline messages, navigation, folding, narrow layout, and
light/dark rendering. The Electron E2E build passed. No installer was produced.

The broad E2E typecheck still reports existing missing cloud dependencies and
other repository errors; localization coverage reports the existing unlocalized
language-server message. These checks are not reported as passing.
