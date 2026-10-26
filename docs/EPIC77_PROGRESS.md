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

## 2026-10-26 — independent review repairs (Codex)

The realistic description-bearing, receipted scan regression now distinguishes
unchanged adverts from genuine responsibility changes. Live evidence and durable
token hashes use the same comparison representation; new receipts keep all 80
bounded token hashes, while older 32-token receipts remain readable. Advert-update
digests survive projection unchanged. Five consecutive coordinated scans cover
initial addition, repeated verification, a real advert change and its recheck.
Both new regressions were observed failing before the repair. No advert body is
added to durable scan artifacts.
## 2026-10-25 — supply-chain (Codex)

- F-2: CI now uses the same immutable checkout and Node setup commits already
  pinned in the release workflow. Their upstream `v4.4.0` tag identities were
  checked. Policy coverage discovers every secret-bearing workflow and checks
  every action in it, including jobs that do not receive secrets themselves.
- F-3: allowlisted application and public-source trees exclude nested
  `node_modules` directories, including case variants. A real staging
  composition covers every copied tree and confirms top-level production
  packages and their required nested dependencies remain available.
- Observed RED before each fix: F-2 reported four mutable CI action references;
  F-3 reported copied dependency trees. Each focused regression then passed.
  Release staging, privacy-audit and workflow tests passed together: 71/71.
- F-1, D-1, platform signing, package publication and live systems are outside
  this change. Full-suite and hosted-platform evidence is recorded in the draft
  package PR; Linux tests use a process-reaping wrapper outside the repository
  because this disposable container's PID 1 does not reap orphaned children.
## 2026-10-25 — discovery correctness (Codex agent)

Branch: `friend/discovery-correctness`, based on `integration/epic77-progress`
at `93048fd`. No issue acceptance boxes or earlier progress entries were changed.

- **B-1:** Adzuna uses queried-country salary currencies with explicit currency
  provenance; unsupported currencies remain unknown. Cross-currency legacy
  source minimums are omitted. Setup and Sources settings expose the country;
  existing saved/default countries and historical assessments are preserved.
- **B-2:** Shared URL, provider-reference and employer/title-token indexes block
  grouping and durable-ID comparisons before the unchanged complete predicate.
  First compatible groups and all-member agreement remain authoritative. The
  5,000-vacancy bounded regression failed before the fix (10-second timeout) and
  passed after it (about 1.03 seconds including prior reconciliation).
  Separate synthetic 2,500 and 10,000 measurements took about 0.65 and 2.05
  seconds. These are development-container measurements, not VPS evidence.
  Thirty deterministic 80-observation differential batches matched pre-fix
  production grouping and durable reconciliation exactly.
- **B-3:** Generated onboarding profile/CV instructions use the workspace locale.
- **B-4:** Small plural pools try soft diversity before recorded relaxation;
  above-threshold vacancies still fill spare capacity. Recommended policy:
  keep relaxation explicit rather than letting a small pool bypass diversity.
- **B-5:** History readers normalise hyphenated rejection aliases to persisted
  underscore outcomes. A production-reader/lifecycle regression covers the
  mixed 384-assessed/128-pre-assessment history boundary and 600 remembered
  rejections with version-triggered reassessment beyond it.

Every new regression was observed failing before its fix, including the
country Settings browser action. Focused checks passed; full Node verification
passed 1,509 total, 1,503 passed, 0 failed, 6 platform skips. Chromium Settings
passed 29/29 and first-run onboarding passed 6/6 using the installed system browser. Firefox and native Windows
execution were not performed. Tests used only synthetic workspaces and stubbed
source/provider boundaries. A scoped child-subreaper wrapper outside the
repository is needed in this container because its PID 1 does not reap orphan
children; neither Scout nor its tests were weakened for that environment.

Self-review added a failing historical-fingerprint regression before excluding
currency-provenance metadata from semantic change detection. The provenance
still persists with salary evidence; a real amount or currency correction
still counts as material. An unchanged old salary therefore does not consume
assessment capacity merely because it acquired provenance on upgrade.
## 2026-10-25 — retention package (Codex)

- A-1: real recovery selection no longer pins historical terminal skips or a
  completed recovery forever. Current leases, queue claims, damaged journals and
  unreceipted mutations remain protected. Reviewed encrypted cleanup retains the
  selection audit. Bounded selection compaction preserves current dispositions
  and full encrypted before/after evidence, including crash/successor recovery.
- A-2: status measurement no longer reads artifact bodies; a synthetic 100 MiB
  inventory took 2.5 ms with zero artifact body reads. Review/archive comparisons
  still hash content. Setup/opportunity responses measure scan health once.
- PROV-1: new diagnostic inputs are private run-owned artifacts. Legacy external
  inputs count towards pressure and use the existing explicit reviewed archive
  lifecycle; no silent deletion occurs.
- Observed RED before fixes: historical terminal cleanup and completed-selection
  release; mutation/damaged-journal composition; 100 MiB artifact-body read;
  duplicate per-response inventory; legacy pressure/archive; two actual runtime
  scan projections; compaction/crash receipt and stale-fence replacement.
- Full Node and final focused verification are recorded in the package PR.
  Linux execution only; no live workspace, provider, host or Windows/macOS check.

Retention self-review also reproduced a corrupted prepared compaction count being
accepted. The receipt now binds the removal count and archived file sizes/digests
to the verified before/after bytes; the RED corruption composition is GREEN.
## 2026-10-25 — provider-truth (Codex)

- Preserved definitive remote authentication failures through checking, sign-in
  mutation and local credential evidence until real remote success. Ordinary
  checking/login progress no longer produces a failure alert; old records remain
  readable.
- Shared provider presentation across cards, sign-in guidance and doctor/setup
  projections. Local credentials are visibly unverified. Chat, fit assessment and
  onboarding use production preflight and persist health before releasing work.
- Saved authentication-failed chat requests gain an explicit single-use resend,
  without duplicating the original user message. Asynchronous preflight reserves
  admission and honours Stop for sends and handoffs. Transcript-save diagnostics
  never expose filesystem paths.
- New regressions were observed failing before their fixes, including real
  health/auth-mutation/HTTP compositions, message resend replay, sign-out draft
  preservation and handoff Stop/admission. Relevant Chromium chat/reconnect tests
  passed; final exact-head suite counts are recorded in the draft PR.
- Tests use disposable synthetic workspaces and stub only provider/process or
  HTTP boundaries. This Linux container requires an outside-repository child
  subreaper because PID 1 does not reap terminated orphan test processes. Native
  provider, Windows/macOS and live acceptance remain unverified; #76 stays open.

## 2026-10-26 — resend durability review repair (Codex)

Explicit chat and fit-assessment resends consume their one-use token under the
workspace mutation authority before provider execution. Failure to save that
reservation blocks execution. A later transcript-save failure cannot revive
the token. Three real-file regressions were observed failing before the repair;
they cover reservation failure and completion persistence failure for both paths.
If Scout exits after reservation, the user reviews the conversation and composes
a new request deliberately; automatic replay is never attempted.
## 2026-10-25 — Codex: workspace modes and local alerts

- Added per-workspace background watch and active hunting choices to the setup
  conversation and Settings; existing workspaces default to background watch.
  Both modes use the existing deterministic ranking and assessment gates, with
  different bars, result caps and daily active-hunt digest behaviour.
- Added bounded local alerts with durable provider episodes, per-vacancy tracker
  dedupe, acknowledgement and a delivery outbox. Scan alert state is part of the
  tracker/report mutation receipt. Runtime alerts and delivery receipts use
  companion files so later acknowledgement cannot invalidate crash recovery.
- Preserved exceptional pending matches across active-to-background changes and
  kept lifetime match dedupe on existing tracker entries so historical active
  matches cannot fill the outbox. Dashboard acknowledgement can free historical
  capacity without pretending native delivery occurred.
- Windows tray delivery uses an immutable notification/icon owner, shared status
  balloon arbitration and bounded local HTTP calls. Delayed events from a retired
  icon cannot acknowledge a newer match. No outbound notification service was
  added. The C# change was reviewed by reading; Windows compilation, installation
  and notification-settings acceptance remain unverified on this Linux host.
- Verification observed RED then GREEN for mode defaults/policy, assessed-score
  thresholds, notification schema, provider partial-commit dedupe, scan receipt
  recovery, mode changes, 10,000-match capacity, dashboard-only acknowledgement,
  distinct query-only adverts and the real ranked scan-to-alert path. Chromium
  setup/settings/alerts checks passed 37/37; Firefox was unavailable. Full-suite
  counts and exact tested head are recorded in the draft package PR.
- The Linux test container's PID 1 does not reap orphan processes. Tests use an
  external child-subreaper wrapper; Scout's process tests were not weakened.
  F-1, D-1, live provider checks, private workspaces and deployment were untouched.

- Follow-up self-review isolated provider-warning capacity from match history.
  Health replacement always wins over notification-storage errors; a bounded
  pending intent preserves failure/recovery episodes until publication. The
  independent 64-record operational reserve retires superseded/resolved history
  while retaining current warnings and monotonic episode identities.

## 2026-10-26 — native and browser acceptance (Codex)

The test-only native contract was pushed after a green full Linux Node suite.
Hosted Windows run 40289028575, job121459460790 then observed RED at the actual
C# compiler: CS0246, missing NotificationDeliveryState. Its implementation now
shares real shown-event and receipt state with an executable C# assertion suite.
The same native test measures staged/default Windows paths and a byte-preserving
round trip beyond MAX_PATH. Linux skips that native test honestly.

Expanded CI exercises all three browsers on Ubuntu, Windows and both macOS
architectures. Initial WebKit execution exposed service-worker routing isolation,
Safari modal return focus and a real unhandled backup-queue rejection. The
queue rejection reproduced RED in a disposable child process and passed after
its internal tail was observed. Hosted GREEN and installed-artifact acceptance
remain pending until actually executed; F-1 packaging remains separately owned.
