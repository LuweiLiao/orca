# LLW Integration Validation

Integration started October 24 and verification continued October 25, 2026
(Asia/Shanghai). Upstream base: `4e7c3538e5`.

This file records checks on the combined LLW source. Prior feature evidence is
listed separately in [LLW Development](llw-development.md).

| Check                                                                   | Current result                                                                                                                    |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Four typecheck projects                                                 | Passed again after the integration corrections                                                                                    |
| CLI and Electron builds                                                 | Passed; corrected desktop rebuilt before editor acceptance                                                                        |
| Browser client and mobile web bundle                                    | Passed; mobile bundle hash/size checks passed                                                                                     |
| Headless Orcad build                                                    | Passed; 7,129 modules with zero Electron and `node:sqlite` imports                                                                |
| Changed-source unit/integration tests                                   | 92 files passed in the final broad run; the real-Git removal file hit timing failures under concurrent validation, recorded below |
| Updater and packaging regressions                                       | 34 files passed, 1 skipped; 388 tests passed, 40 skipped                                                                          |
| Combined annotation/reference sends                                     | 2 files, 31 tests passed                                                                                                          |
| Repeated-frame editor regression                                        | 8 tests passed, including four cases that failed before the correction                                                            |
| Conversation RPC/host routing                                           | 2 files, 6 tests passed, including headless refusal and desktop forwarding                                                        |
| Full LLW changed-code quality gate                                      | Final publication scan passed: 375 code files, six scans plus SAFETY check, zero new findings                                     |
| Hidden feature journeys                                                 | All 13 original scenarios now have passing evidence; WSL picker and three additional concurrency/reorder scenarios also passed    |
| Conversation reference renderer and background service                  | Passed drag/drop, preview, send instructions, long-source pagination and source-only search                                       |
| Generated RPC, bundled skill-guide, localization and readme-link checks | Passed                                                                                                                            |

## Corrections Found During Integration

- The inline annotation UI removed the old manual transfer button. Replaced its
  obsolete tests with persistent accepted/refused-send and cleanup-retry tests.
- Conversation RPC originally imported the desktop connection implementation,
  which pulled Electron into Orcad. Forwarding now uses the existing optional
  runtime desktop surface; headless hosts report unavailable foreign references.
- A second peer frame could drop the dirty editor's selection after its tab had
  been reinserted by the local merge. Retention now checks the raw incoming frame.
  Four repeated-frame cases failed before this change and pass after it. The
  rebuilt hidden editor test preserves the draft and saves it after peer close.

Source correction commits: `31b1f6f3fa6` and `ddd93aa6207`. Normal commit hooks
ran without bypasses.

## Failed Runs And Limits

The first broad source run reported 1,045 passing tests and four failures: two
obsolete transfer-button tests, one watcher assertion and one real-Git removal
timeout. The watcher/removal suites passed together in isolation (34 tests) with
unchanged timeouts. A later broad run passed 92 files but hit five 30-second
timeouts in the same removal file while builds and hidden apps ran concurrently.
These broad runs are retained and are not described as globally green. The final
default-runner isolated rerun passed 16 tests and timed out in two. Running the
three matching cases directly under Node passed all three (15 other tests were
not selected). Assertions and timeouts were unchanged. The earlier full isolated
34-test pass and the later runner-specific failures are both retained; a fully
green default-runner suite is not claimed.

The first hidden suite passed 12 of 13 scenarios. The editor scenario failed
again in isolation, led to the repeated-frame correction, and passed after a
fresh build. The three final concurrency/reorder scenarios passed after that
correction. The separate WSL picker test uses the fake transport; real WSL 2
evidence remains tied to the original feature revision.

The rebuilt headless server completed real pairing, project/worktree creation
and a terminal command round trip. Its script then failed on Windows `EPERM`
while removing temporary data. A read-only process check found no Node process
referencing that profile. Automatic approval review rejected subsequent cleanup
of the two exact test directories with `blocked by policy`, so they remain:

- `%TEMP%/orca-serve-smoke-FQ7Yfj`
- `%TEMP%/orca-smoke-repo-itPGCO`

The terminal flow succeeded, but the complete smoke script is not marked green.
No native macOS/Linux desktop, visible-window focus, real agent credentials/send,
installer upgrade or physical storage-failure acceptance is claimed.

Local logs are under `output/llw-integration/` in the integration worktree.
No new installer or `.deb` has been built for LLW. No installed app was replaced.
