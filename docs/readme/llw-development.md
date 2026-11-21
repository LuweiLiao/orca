# LLW Fork Development

`llw` is the fork's integration branch. It starts from upstream's default branch
and carries the local features that we use together. Upstream PRs remain focused
feature branches, so the fork can remain usable while those PRs are reviewed.

## Branch Bases

| Work                                             | Start from      | PR target                            |
| ------------------------------------------------ | --------------- | ------------------------------------ |
| Independent fix or feature suitable for upstream | `upstream/main` | `stablyai/orca:main`                 |
| Change that depends on LLW-only behavior         | `origin/llw`    | `LuweiLiao/orca:llw`                 |
| Combined validation and local releases           | `origin/llw`    | No upstream PR from the whole branch |

The upstream default branch is `main`, confirmed on October 24, 2026. If upstream
renames it, verify its remote HEAD before using `master` or another branch.
Do not use the old `local/release`, `local/linux-deb-full`, or archived worktrees
as development bases. Existing public PR branches keep their own review history.
Before continuing a feature, refresh its designated base and rebase that feature
branch when appropriate; coordinate any rewrite of an already published branch.

```sh
git fetch --no-tags upstream main
git fetch --no-tags origin llw
git switch -c feat/example upstream/main
# For a change that needs LLW features instead:
git switch -c feat/llw-example origin/llw
```

## Integrating A Feature

1. Implement and test in its feature branch. Keep each change limited to its
   feature, including the tests that demonstrate its behavior.
2. Submit independent upstream work from the feature branch. Do not include
   unrelated LLW features or fork release settings in that PR.
3. Integrate the reviewed commits into `llw` with `git cherry-pick -x`. The source
   trailers preserve the relationship to the feature branch and upstream PR.
4. Resolve conflicts against current upstream behavior. Test the combined
   behavior, especially shared send, storage, window and host-routing paths.
5. Push `llw` after its checks pass. Build releases from an identified, tested
   `llw` commit, and record the exact source SHA in the package receipt.

If work began on `origin/llw` but later becomes suitable for upstream, create a
new branch from `upstream/main` and port just that feature. Never send the full
`llw` history as an upstream PR. Subsequent upstream review fixes must also be
integrated and retested on `llw`.

## Updating Upstream

Rebasing keeps the fork changes on top of upstream and avoids accumulating merge
commits. Because published `llw` history changes, coordinate a maintenance window
before rebasing it. Preserve a named backup, record the published SHA, and use
an explicit lease when replacing the remote branch.

```sh
git fetch --no-tags upstream main
git fetch --no-tags origin llw
git switch llw
git status --short
git rev-parse origin/llw
git branch backup/llw-before-upstream-YYYYMMDD
git rebase upstream/main
# Run the combined checks and rendered feature scenarios before publishing.
git push --force-with-lease=refs/heads/llw:<recorded-origin-llw-sha> origin llw
```

Do not rebase dirty worktrees or update another person's feature branch. After
an LLW rebase, rebase LLW-dependent feature branches with their recorded old base
using `git rebase --onto origin/llw <old-llw-base> <feature-branch>`; review the
resulting diff before pushing. Keep upstream feature branches based on upstream.
When upstream accepts a feature, verify its behavior there and remove only the
duplicate fork changes; compare patches as well as commit IDs.

## Integrated Features

Initial upstream base: `4e7c3538e506b7eebb069911be9269ac834c3356`.

| Feature                                                      | Source revision                                                                        | Existing functional evidence                                                                                                                                   |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent native desktop windows and follow-up fixes       | `b3066538a2`, including `d8add9e6e3`, `fc92d0b4dd`, `d8f42cac10`                       | Hidden Windows flows for independent workspaces/bounds, terminal survival, browser ownership/profiles, skills, file watchers and unsaved editor retention      |
| WSL selection while adding a project                         | `f0c13060b6`                                                                           | Real Ubuntu 20.04 / WSL 2 project, folder, file read/write, Git and PTY flows                                                                                  |
| Empty unregistered worktree deletion retry                   | `ff2c58b89a`                                                                           | Regression tests for empty/missing paths and protection of replacement data and nested worktrees                                                               |
| Persistent annotations, transfer and draft recovery          | `6760f8058d` through `3e8b19aa96`                                                      | Hidden annotation/reload flows and accepted/refused-send, concurrent-edit, recovery and paste-reference regression tests; earlier packaged Windows/Linux flows |
| Inline annotation editor and send-time annotation collection | `c43a60fc0b`                                                                           | Hidden desktop/narrow and dark/light UI flows; PTY/structured accepted-send cleanup tests                                                                      |
| Windows chat file/folder reveal                              | `d077a27b25`, `94da873213`                                                             | Hidden real path validation before the OS reveal boundary; Windows and Ubuntu 20.04 parser/guard tests                                                         |
| Conversation drag references, preview, CLI read/search       | `698167f2c10`, ported from the preserved `feat/native-desktop-multi-window-2` snapshot | Hidden drag/preview/send-instruction flows, compiled background long-source pagination/search, RPC and native journal tests                                    |
| LLW GitHub updates                                           | See [LLW Releases](llw-releases.md)                                                    | Fork feed, background download, explicit restart and Debian desktop update tests                                                                               |
| Packaging excludes local build/test artifacts                | `91eeb997e4`                                                                           | Package payload comparison and exclusion regressions                                                                                                           |

LLW integration added `31b1f6f3fa6` to keep conversation forwarding out of the
headless build and `ddd93aa6207` to retain dirty editor selection over repeated
peer frames. Carry these fixes when preparing the corresponding feature PRs.

The deletion retry has automated behavior evidence, without a separate native UI
acceptance claim. WSL evidence above belongs to its original source revision;
it does not certify a new LLW service deployment. Earlier Windows/Linux package
validation belongs to those exact artifacts, not this new branch. Real agent
credentials/sends, native desktop focus, installers and physical storage failure
are separate checks.

Queue settings are searchable and explain unsupported hosts; ordinary follow-up
queueing is not enabled. Trae CN / DeepSeek Harness import and Claude permission
investigations remain assessment-only and are not included as implemented work.

## Validation Rules

- Run typechecks, focused regression tests, generated-contract checks and the
  changed-code quality gate against `upstream/main` for the complete LLW diff.
- Rerun meaningful feature journeys after integration and upstream rebases.
  Tests and agent-launched apps use `ORCA_BACKGROUND_LAUNCH=1`, isolated data and
  hidden renderers. Never activate a user's desktop window for validation.
- Record source validation, compiled builds, rendered checks, real host execution
  and packaged-program validation separately. A test count alone is not evidence
  that an installer, an agent account or every supported platform was tested.

See [LLW Validation](llw-validation.md) for this integration's actual results.

The November 1 follow-up queue integration and keyboard behavior are described
in [Chat Follow-ups](llw-follow-up-queue.md).

The model catalog, Mermaid viewer and host model/effort defaults integration is
described in [Agent Model Defaults](llw-agent-model-defaults.md).

## 2026-11 迁移到新上游

- 做法：以 upstream/main（基线 `94c7ab74286`）为底重建 `llw-next`，llw 的功能逐个搬运。旧 llw 保存在 `backup/llw-before-upstream-20261120`。
- 判定上游已覆盖而跳过：`13bb8cf28e6`、`957091d5c7f`、`357b86418c8`、`0a114884743`、`e72aa990710`、`fd5054c4d57`、`cef96c18650`、`ed4408aba6b`（上游 Windows 原生删除路径）、`3057c0e0e2c`（上游 Add WSL distro 对话框）、`d089f5dc642`（上游 full-access policy）、`f8bcdfb8abf`（上游 E9）；队列、Mermaid 和模型目录功能由上游 PR 合入。`3c87a4492e5`（orcad 模板）待打包时验证，尚未确认。
- 因改用上游原生分叉而跳过：文本交接、多对话合并、摘要交接、分支对比、时间线。项目地图的分叉改用上游的 `agentSession.create` 和 `forkFrom`，父子关系读取 `forkedFrom`。
- 手机端按用户要求不再维护：手机端关系列表相关提交（`16876350eba`、`bf53503f2e4`、`3ba149cc3ed`）跳过，之后的搬运和测试不处理 `mobile/`。
