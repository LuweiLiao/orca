# Chat Follow-ups

LLW integrates the native-chat queue controls from upstream #36588, the mid-turn
Send button from #36655, and input ordering/recovery from #36430.

While an agent works, Enter queues a follow-up by default. Ctrl+Enter on Windows
and Linux, or Cmd+Enter on macOS, sends that message into the running turn.
Ctrl/Cmd+Shift+Enter sends the first waiting message into the turn. The Chat
Behavior setting can turn the default queue off; modified Enter then queues one
message instead. Shift+Enter still inserts a newline.

A typed draft or an image makes Send replace Stop. An empty draft offers Stop.
Esc still stops work and retains the draft. Sending guidance into the active
turn uses the provider's steering path; it does not mean cancelling the turn
and creating another one.

Queue cards remain editable and removable. Stops, restarts and history
replacement preserve the input order and original receipt. LLW retains its
existing journal-row storage format and carries input lineage in epoch rows;
this integration does not migrate to upstream #36024's keyed outcome storage.

Desktop and mobile negotiate `agent-session.queued-messages.v2`. An older host
without that capability retains its existing immediate-send behavior. Mobile
follows the connected host's live queue setting and offers Queue/Steer choices
by holding Send when those choices differ.

The integration preserves LLW's image-read previews, CCB launch/model support,
annotations and GitHub update channel. No release installer is produced merely
by merging these source changes.

Sources:

- https://github.com/stablyai/orca/pull/36588
- https://github.com/stablyai/orca/pull/36655
- https://github.com/stablyai/orca/pull/36430

Verification records for the November 1, 2026 integration are retained locally
in `output/queued-followups-integration/`.
