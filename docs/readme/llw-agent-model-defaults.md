# LLW model catalogs, diagrams and agent defaults

Integrated on November 1, 2026, from LLW baseline
`b83535d0250bcd99f223f6f20c585ecc43dd378c`:

- #36646, `a2235ad4b9fee187f73abc356cf505e28525d249`: retain a complete
  account model list while a new folder's own probe runs. The temporary list
  declares neither the folder's default model nor its default effort; a finished
  folder listing replaces it. Account changes never reuse the previous account's list.
- #36575, `51e183a08e0`: connect Markdown previews, rich Markdown, Mermaid files
  and comments to the existing diagram viewer, including zoom, drag and close.
- #36210, `12edee3ac61aba50f73ad3b8ac1b0d6cf80a68d5`: store model and effort
  defaults separately from CLI Arguments, with host-owned persistence, migrations,
  launch precedence, legacy publication and rollback after a failed save.

These are adapted integrations: LLW predates upstream's catalog and launch UI
refactors and also supports CCB. The shared upstream choice parser and compiler
are reused against the existing LLW creation paths.

## Using defaults

In Settings > Agents, select the host, expand an installed agent, and choose
Default model and Default effort. Model discovery uses the existing host/CLI
discovery path. CCB runs its own `ccb` discovery; it never borrows Claude's account
catalog. A saved model absent from the current listing remains identifiable and
can be cleared. Effort can be configured without forcing a model where the CLI
supports that combination.

Defaults apply to new chats, terminal launches and workers on the executing host.
Explicit launch choices take priority. Recognized model and effort arguments move
to the dedicated fields; ambiguous literal arguments remain intact. Saved session
recipes remain authoritative for resume. CCB keeps its own model/effort defaults
even though its structured session uses the Claude provider and transcript format.

New hosts advertise `settings.agent-launch.choices.v1`. Older hosts retain the
existing controls and do not receive the new mutation. Their published terminal
argument representation remains supported. Downgrading the executing app to a
version without model-default storage does not preserve these new choices.

## Validation

- Desktop/node/CLI typechecks and the mobile TypeScript check passed.
- Changed-code checks, including types, React, design-system and casting checks,
  passed with no new findings. RPC parameter catalog, file-length, focus-read and
  localization checks passed.
- Expanded unit coverage: 4,045 passed, one expected failure, six skipped. Nine
  additional test files reported 165 Windows `EBUSY` errors while deleting their
  SQLite journals. Running those same nine files on the unchanged baseline
  reproduced the same 165 failures. The separate OMP history-adoption test also
  fails with `agent_session_identity_required` on both revisions.
- Six hidden Electron journeys passed: CCB default selection/save/reload and
  explicit override; CCB model/effort discovery and fixture worker launch; Mermaid
  preview/rich/file expansion in light and dark themes; queued follow-ups,
  immediate steering and retained drafts; inline tool image display and expansion.
- The Electron app was rebuilt in e2e mode. Provider execution used the local
  fixture CLI; this does not claim a live gateway, remote SSH host, installer or
  release validation.

Detailed command output and screenshots are in the local, untracked
`output/models-mermaid-defaults/` directory and Playwright's `test-results/`.
This integration does not create a release.
