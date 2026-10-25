# Epic #77 / #76 progress: where the integration branch stands

Snapshot date: 2026-10-25. Branch: `integration/epic77-progress`, built from `claude/issue76-reauth-ux` (`e225595`) plus two clean merges of OpenCode test branches. It sits on `main` at `1f8310c` (PR #83) and is proposed as a draft PR. Nothing here is merged to `main`, no GitHub checkbox has been ticked and no issue has been closed; the maintainer does the merging and the ticking.

New work should branch from this branch, not from `main`, so it builds on the pieces below.

The box-by-box reality check of the epic at `1f8310c` lives with the maintainer; its headline is that 72 of the 89 unticked Epic #77 boxes were already implemented in code and only needed acceptance evidence. The pieces below close the genuine code gaps that check and a code read found.

## What is done (in merge order)

| # | Branch | Commit | What it does | Epic lines satisfied |
|---|---|---|---|---|
| 1 | `claude/epic77-rank-why` | `ac72eac` | The persisted explanation for each rank keeps dimension, contribution and evidence (it used to keep a bare rule code and drop the score), so a report can say why a job ranked high. | A5 line 97 (interpretable dimensions), A8 line 142 (each vacancy explains why) |
| 2 | `claude/epic77-lifecycle-reasons` | `cb1e0f3` | Every ranked vacancy records why it was skipped, re-ranked or reassessed. The rules are a table in `docs/SCOUT_SCAN_PROTOCOL.md`. | A4 line 83 (when a vacancy is skipped, revalidated, re-ranked, reassessed, changed) |
| 3 | `claude/epic77-rejection-memory` | `74586ad` | An unchanged rejection stays out of assessment capacity beyond the recent ~384-record history window. | A4 acceptance line 88; supports A11 line 184 |
| 4 | `claude/epic77-assessment-versions` | `9a7dded` | Each assessing scan stores `assessment_version` (promptVersion, assessmentSchemaVersion, provider, model); a change re-assesses earlier rejections, at most 6 per scan. | Supports A4 line 83 and A7 line 127; no new box |
| 5 | `claude/epic77-scan-states` | `05ab6db` | `retrying` and `recovered` are distinct states in the UI via a shared `ui/lib/durableRunStates.mjs`. Identical to OpenCode's `codex-oc/scan-states` (`f95945a`, same patch id), so that branch is already covered. | A2 line 50 (states shown in the UI) |
| 6 | `claude/issue76-reauth-ux` | `e225595` | Persistent amber banner on every tab while a provider is `sign-in-required`, naming the provider and its scheduled jobs. Reconnect, Remind me later, Run missed scan now, Retry now. `GET /api/provider-health`, `POST /api/provider-health/acknowledge`, `docs/RECONNECT_PROVIDER.md`. | Moves A10 line 172 (#76) forward; still Partial |
| 7 | `codex-oc/rank-explanations` (merged) | `f077df0` | Tests: each dimension score equals the sum of its contributions, and ranking is stable for equal inputs. | Evidence for A5 line 97 |
| 8 | `codex-oc/tests-physical-path` (merged) | `58a37c5` | Tests for the `validatePhysicalWorkspacePath` escape and symlink guards (new `ui/lib/physicalPath.test.mjs`). | Evidence for the workspace-safety audit item D-4 |

Verification on the pieces: each piece passed the full `npm test` on its own branch (1458 to 1484 tests, 0 fail); the integration branch itself passed the full `npm test` on 2026-10-25: 1501 tests, 0 fail, 3 skipped.

## Decisions and limits worth knowing

- Rejections recorded before piece 4 have no assessment version, so a version change does not re-assess them. They are assessed again on the usual triggers (advert, profile or learning change). This avoids a surprise spend on first deploy.
- `promptVersion` already contains a digest of profile, calibration, master CV and scoring config, so editing the CV or calibration also counts as a prompt change (still bounded to 6 per scan).
- A provider failover inside one run records the run's starting provider and model.
- Piece 2 found that recording a lifecycle per vacancy pushed the 2,500-job stage artifact over its 16 MiB limit, so new vacancies are not stored (explanations infer "new"). Piece 1 grows the run-log record about 32% per explanation (2.14 MB to 2.83 MB for 2,500 vacancies).
- Piece 5: `recovering` is gone. A run whose latest event is `recovery.started` with no work since reads "Recovered compatible work", a few seconds early. Keep `recovering` as a separate in-progress state if that matters.
- Piece 6: "Remind me later" shrinks the notice to one line; there is no timed snooze, because `acknowledgeProviderAlert` never re-stamps an existing acknowledgement. A new failure after recovery is a new alert and shows in full. Run missed scan now relies on the host scheduler (schtasks, launchctl, systemd) and was not exercised against a real one. Firefox was run for provider-reauth only.
- New worktrees need `node_modules`; without it 5 CV-import tests fail with request-failed.

## What is left

Epic #77 and #76 stay open. Operator-only items (marked **Oliver**) need live providers, the VPS or the private workspace and should not be attempted by an agent.

### A. Alerts that reach a person (the "once-a-year match" path)
1. Out-of-app notification. `shouldNotify` (`ui/lib/providerHealth.mjs`, `ui/lib/scheduler.mjs`) has no consumer; the Windows tray host (`installer/windows/ScoutHost.cs`) only shows update and recovery balloons. #76 asks for one deduplicated tray or native notification. The same channel should carry a strong-match alert: today a strong match is only announced inside the open dashboard (`strongUnseenMatches` in `ui/app.js`).
2. One-click resend of a failed chat message after re-authentication (the message is kept; the guide says to send it again).
3. **Oliver:** the four live #76 checks: expired Claude session gives `sign-in-required`; revoked or refresh-failed Codex session; guided re-auth over the remote path with retry resuming the work; a scheduled scan failing preflight shows on the dashboard.

### B. Post-merge audit remediation (31 findings: 2 Critical, 10 Important, 14 Minor, 5 Provisional)
The durable ledger is `docs/implementation/epic-77-post-merge-audit-remediation.md` on draft PR #84 (`033912444d92`). It orders the work as seven workstreams; the next beta is paused until its blockers close. Status:
- F-1 sealed release-snapshot authorization: draft PR #84, in review. Do not duplicate.
- D-1 fenced workspace adoption: a local-only branch exists elsewhere, unpushed and unfinished. Do not duplicate.
- Provider authority and truthful UI (C-1, E-2, C-2 to C-5): open.
- Retention and storage lifecycle (A-1 recovery pins, A-2 lazy digests, PROV-1 `.scout/scan-input` retention): open.
- Discovery correctness and scale (B-1 Adzuna currency from the queried country, B-2 quadratic duplicate grouping, B-3 locale in copy, B-4 small-pool diversity caps, B-5 reason-code vocabulary and the 384-record horizon): open. Piece 3 partly overlaps B-5; re-check before starting.
- Supply chain (F-2 pin every action in secret-bearing workflows, F-3 nested `node_modules` in allowlisted trees): open.
- Remaining Minors, Provisionals and Epic-truth documentation (E-1, E-3 to E-6, D-2, D-3, D-4, PROV-2 to PROV-5): open. PROV-3 (retrying/recovered states) is addressed by piece 5.

### C. Epic boxes that are acceptance or process, not code
A2 line 50 is now done. These stay open: A10 line 172 (#76, see A), A11 lines 186 (privacy/security audit), 188 (VPS deploy and rollback rehearsal, live acceptance), Gate A lines 266 and 273, delivery rules 255, 256, 258, 260, and the full-epic definition lines 279 to 282 and 284 (code exists, release acceptance open). **Oliver** and the maintainer own these.

### D. Other issues
- #30 (audit backlog): everything is ticked except "Longer-term release security": sign platform packages or publish a signed manifest, document key ownership, rotation and revocation, keep SHA-256 verification. Needs a product decision on signing before any work.
- #63 (operator context stale after beta.20): the fix is in the private workspace on the authoritative host and cannot be done from the public repo. **Oliver**.

## Appending your own progress
Work done after this snapshot goes in its own section below, signed with the author or agent and dated. Leave the "What is done" table above as the record of this snapshot.

## 2026-10-25 — truth-docs (Codex)

| Finding | Disposition and evidence |
| --- | --- |
| E-1 | Fixed: the opportunities API distinguishes publication-required, legacy and ranked discovery. Established legacy users see a persistent disclosure and profile-review action; publication clears it. Fresh-workspace gating is preserved. API and user-action regressions were observed RED, then GREEN. |
| E-3 | Fixed current protocol and scan-skill authority guidance: installed execution uses renewable fenced leases, process identity and durable queueing, not a two-hour advisory-lock recovery rule. |
| E-4 | Reproduced clipping at 381 px, then fixed status wrapping across 381–700 px, polite live announcements and complete title text. Chromium regression observed RED, then GREEN. |
| E-5 | Reproduced out-of-order tracker rendering, then added request-generation admission before state/render updates. Production-function and browser regressions pass. |
| E-6 | Fixed setup, scan-result and guide wording: commute affects assessment context and dashboard filtering, not ranked-discovery filtering. Browser copy regression observed RED, then GREEN. |
| D-2 | Fixed one-way coexistence claims: current Scout rejects a legacy lock, but cannot make an older binary honour new fencing. Stop-old-process and disable-old-schedule instructions are explicit. Existing sentinel-shaped records remain compatibility input; no sentinel writer or refresh was introduced. |
| D-3 | Deferred native long-path acceptance to the maintainer under Epic #77. No current application path-length threshold or `core.longpaths` consumer was found to justify a production change. This Linux environment cannot verify native Windows Git/filesystem limits. |
| D-4 | Ported two existing Windows-bypassed snapshot escape tests to junction fixtures. Reproduced the hosted macOS canonical-temp-root failure with a synthetic Linux temp-directory alias, then canonicalised fixture roots without changing production guards (12/13 RED, 13/13 GREEN under the same alias). A separate fixture-cleanup interleaving proved a successor guard could be removed; atomic retirement and early close observation repair that test fixture. The original ARM exit lacked stderr, so its exact cause still needs a hosted rerun. Existing direct physical-path and mutation-junction coverage is retained; native Windows remains unverified. |
| PROV-2 | Fixed the production queue-to-public-status composition: historical scheduled `manual-discovery` compatibility purposes display as scheduled discovery without changing durable identity or deduplication. RED then GREEN. |
| PROV-4 | Fixed with a real unchanged keeper outcome, reconciled at total and source level. A self-review reproduced projection drift through the receipted writer, then bound comparison to the same production tracker projection and retained closed tracker-outcome fields in run recipes. Verification/history and notification bookkeeping remain fresh without reporting changed job content. Both compositions were RED then GREEN. |
| PROV-5 | Corrected semantic-fact documentation to describe stopword removal, duplicate elimination and bounded facts. No extra advert or profile body is retained. |

PROV-3 was already done and was not repeated. F-1, D-1 and live operator
acceptance remain outside this package. Package branches and PRs are review
evidence, not merged-main or release acceptance. Exact-head full-suite, browser
and privacy evidence is recorded in the draft package PR.
