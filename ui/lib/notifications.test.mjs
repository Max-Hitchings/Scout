import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const at = '2026-10-25T08:00:00.000Z';
const later = '2026-10-26T08:00:00.000Z';
const good = (id, score = 98) => ({ id, score, outcome: 'kept', eligibility: { status: 'eligible' } });

test('background watch stays quiet for ordinary assessed matches and deduplicates exceptional vacancies', async () => {
  const n = await import('./notifications.mjs');
  let state = n.emptyNotifications();
  state = n.notificationsForAssessment(state, { mode: 'background' }, [good('synthetic-a', 82)], at);
  assert.equal(state.alerts.length, 0);
  state = n.notificationsForAssessment(state, { mode: 'background' }, [good('synthetic-b')], at);
  assert.equal(state.alerts.length, 1);
  assert.equal(n.notificationsForAssessment(state, { mode: 'background' }, [good('synthetic-b')], later).alerts.length, 1);
  assert.equal(n.notificationView(state).alerts[0].kind, 'match');
});

test('active hunting accumulates new assessed matches into one daily digest and never emits empty digests', async () => {
  const n = await import('./notifications.mjs');
  let state = n.notificationsForAssessment(n.emptyNotifications(), { mode: 'active' }, [good('synthetic-a', 76)], at);
  assert.equal(state.alerts.length, 0);
  state = n.notificationsForAssessment(state, { mode: 'active' }, [good('synthetic-b', 79)], '2026-10-25T20:00:00.000Z');
  state = n.flushNotificationDigest(state, { mode: 'active' }, later);
  assert.equal(state.alerts.length, 1);
  assert.equal(state.alerts[0].count, 2);
  assert.equal(state.alerts[0].kind, 'digest');
  assert.equal(n.flushNotificationDigest(state, { mode: 'active' }, '2026-10-27T08:00:00.000Z').alerts.length, 1);
});

test('notification schema rejects arbitrary text and delivery is distinct from acknowledgement', async () => {
  const n = await import('./notifications.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-notification-'));
  try {
    n.enqueueProviderNotificationUnderFence(root, { provider: 'claude', state: 'sign-in-required', alert: { id: 'provider-health:claude:sign-in-required', createdAt: at } });
    const first = n.readNotifications(root);
    const id = first.alerts[0].id;
    n.markNotification(root, id, 'delivered', at);
    assert.equal(n.notificationView(n.readNotifications(root)).outbox.length, 0);
    assert.equal(n.notificationView(n.readNotifications(root)).alerts.length, 1);
    n.markNotification(root, id, 'acknowledged', later);
    assert.equal(n.notificationView(n.readNotifications(root)).alerts.length, 0);
    assert.throws(() => n.validateNotifications({ ...first, rawProviderError: '/private/credential' }), /schema/);
    assert.doesNotMatch(JSON.stringify(n.notificationView(first)), /provider-health:|private|credential/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('provider failure episodes survive recovery, deduplicate until state changes and exclude transient checks', async () => {
  const n = await import('./notifications.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-provider-notification-'));
  try {
    const record = { provider: 'codex', state: 'sign-in-required', alert: { id: 'provider-health:codex:sign-in-required', createdAt: at } };
    n.enqueueProviderNotificationUnderFence(root, record);
    n.enqueueProviderNotificationUnderFence(root, record);
    n.enqueueProviderNotificationUnderFence(root, { ...record, state: 'ready', alert: null });
    assert.equal(n.readNotifications(root).alerts.length, 1);
    n.enqueueProviderNotificationUnderFence(root, { ...record, alert: { ...record.alert, createdAt: later } });
    assert.equal(n.readNotifications(root).alerts.length, 2);
    n.enqueueProviderNotificationUnderFence(root, { ...record, state: 'checking' });
    n.enqueueProviderNotificationUnderFence(root, { ...record, state: 'login-in-progress' });
    assert.equal(n.readNotifications(root).alerts.length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('real provider health producer durably queues before a failed health replacement and retries once', async () => {
  const n = await import('./notifications.mjs');
  const { recordProviderHealth } = await import('./providerHealth.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-health-outbox-'));
  const rename = fs.renameSync;
  let injected = false;
  try {
    fs.renameSync = (source, target) => {
      if (String(target).endsWith(`${path.sep}codex.json`) && !injected) {
        injected = true;
        throw new Error('synthetic health replacement failure');
      }
      return rename(source, target);
    };
    assert.throws(() => recordProviderHealth(root, 'codex', { kind: 'remote-auth-failure', source: 'provider-operation' }, { now: new Date(at) }), /synthetic/);
    assert.equal(n.readNotifications(root).alerts.length, 1, 'the failure remains in the outbox even if health replacement fails');
    fs.renameSync = rename;
    recordProviderHealth(root, 'codex', { kind: 'remote-auth-failure', source: 'provider-operation' }, { now: new Date(later) });
    assert.equal(n.readNotifications(root).alerts.length, 1, 'retrying a partial commit must not create a new episode');
    recordProviderHealth(root, 'codex', { kind: 'remote-success', source: 'provider-operation' }, { now: new Date(later) });
    recordProviderHealth(root, 'codex', { kind: 'remote-auth-failure', source: 'provider-operation' }, { now: new Date('2026-10-27T08:00:00.000Z') });
    assert.equal(n.readNotifications(root).alerts.length, 2);
  } finally { fs.renameSync = rename; fs.rmSync(root, { recursive: true, force: true }); }
});

test('scan finalisation includes the exceptional-match outbox in the same receipted mutation', async () => {
  const { coordinateScanArtifacts } = await import('./scanPipeline.mjs');
  const { acquireScanLease, currentLeaseOwner, releaseScanLease } = await import('./scanLease.mjs');
  const { openRunJournal } = await import('./runJournal.mjs');
  const { loadPreparedMutation } = await import('./mutationCoordinator.mjs');
  const n = await import('./notifications.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-assessed-alert-'));
  let lease;
  try {
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'opportunities.json'), JSON.stringify({ updated: '2026-10-25', opportunities: [] }));
    lease = acquireScanLease(root, currentLeaseOwner(), { kind: 'scan', runId: 'run-alert-composition' });
    const run = openRunJournal(root, 'run-alert-composition');
    const candidate = { candidateId: 'candidate-001', vacancyId: 'synthetic-vacancy', company: 'Example Company', role: 'Example Role', source: 'ats', url: 'https://example.test/job', preRankScore: 98 };
    const assessment = { candidateId: 'candidate-001', summary: 'Synthetic fit', responsibilityFit: { rating: 'strong', advertEvidence: 'Deliver services', profileEvidence: 'Delivered services', explanation: 'Aligned evidence' }, mandatoryRequirements: [], transferableExperience: [], uncertainties: [], strengths: [{ point: 'Evidence aligns', advertEvidence: 'Deliver services', profileEvidence: 'Delivered services' }], concerns: [], recommendation: 'keep' };
    const input = { provider: 'codex', mode: 'primary', startedAt: at, candidates: [candidate], sources: { ats: { status: 'healthy', count: 1, jobs: [] } }, assessmentResult: { assessments: [assessment] }, policy: { actionScore: 95, checkScore: 85 }, notificationConfig: { mode: 'background' } };
    const result = coordinateScanArtifacts(root, input, { run, lease });
    assert.ok(result.mutationReceipt);
    assert.equal(n.readNotifications(root).alerts.length, 1, 'assessed keeper must reach the durable outbox at tracker commit');
    const prepared = run.events.find((event) => event.type === 'mutation.prepared');
    const plan = loadPreparedMutation(run, prepared.payload.reference.id);
    assert.ok(plan.files.some((file) => file.key === 'notifications'));
    const matchId = n.readNotifications(root).alerts[0].id;
    releaseScanLease(lease);
    lease = null;
    n.markNotification(root, matchId, 'delivered', at);
    n.markNotification(root, matchId, 'acknowledged', later);
    const { recordProviderHealth } = await import('./providerHealth.mjs');
    recordProviderHealth(root, 'codex', { kind: 'remote-auth-failure', source: 'provider-operation' }, { now: new Date(later) });
    lease = acquireScanLease(root, currentLeaseOwner(), { kind: 'scan', runId: 'run-alert-composition' });
    coordinateScanArtifacts(root, input, { run, lease });
    assert.equal(n.readNotifications(root).alerts.filter((item) => item.kind === 'match').length, 1, 'receipt recovery must not repeat an alert');
    assert.equal(n.notificationView(n.readNotifications(root)).alerts.length, 1, 'the acknowledged match stays acknowledged while the provider warning remains visible');
  } finally { if (lease) releaseScanLease(lease); fs.rmSync(root, { recursive: true, force: true }); }
});

test('switching to background watch preserves an outstanding exceptional match before its active digest', async () => {
  const n = await import('./notifications.mjs');
  let state = n.notificationsForAssessment(n.emptyNotifications(), { mode: 'active' }, [good('synthetic-exceptional')], at);
  assert.equal(state.alerts.length, 0);
  state = n.notificationsForAssessment(state, { mode: 'background' }, [good('synthetic-exceptional')], '2026-10-25T09:00:00.000Z');
  assert.equal(state.alerts.filter((item) => item.kind === 'match').length, 1, 'a mode switch must preserve an undelivered exceptional-match obligation');
  assert.equal(state.pending.length, 0);
});

test('delivery acknowledgement and provider transitions cannot rewrite the scan-receipted outbox target', async () => {
  const n = await import('./notifications.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-receipted-outbox-'));
  try {
    const state = n.notificationsForAssessment(n.emptyNotifications(), { mode: 'background' }, [good('synthetic-a')], at);
    const file = n.notificationFile(root);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(state));
    const before = fs.readFileSync(file, 'utf8');
    n.markNotification(root, state.alerts[0].id, 'delivered', at);
    n.markNotification(root, state.alerts[0].id, 'acknowledged', later);
    n.enqueueProviderNotificationUnderFence(root, { provider: 'codex', state: 'sign-in-required', alert: { createdAt: at } });
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'a later delivery or health transition must not invalidate a prepared scan receipt');
    assert.equal(n.notificationView(n.readNotifications(root)).alerts.length, 1);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('historical qualified matches move into existing tracker metadata so 10000 matches cannot block an active scan', async () => {
  const { createHash } = await import('node:crypto');
  const n = await import('./notifications.mjs');
  const state = n.notificationsForAssessment(n.emptyNotifications(), { mode: 'active' }, [good('sample')], at);
  const tuple = Object.values(state.matches)[0];
  state.matches = {};
  state.pending = [];
  state.digestAfter = null;
  const tracker = { opportunities: [] };
  for (let index = 0; index < 10000; index += 1) {
    const id = `synthetic-old-${index}`;
    state.matches[createHash('sha256').update(id).digest('hex')] = { ...tuple };
    tracker.opportunities.push({ id });
  }
  tracker.opportunities.push({ id: 'synthetic-new' });
  const result = n.notificationsForAssessment(state, { mode: 'active' }, [good('synthetic-new')], later, { tracker });
  assert.equal(Object.keys(result.matches).length, 0);
  assert.equal(result.pending.length, 1);
  assert.equal(tracker.opportunities.filter((entry) => entry.notificationState?.qualified).length, 10001);
});

test('dashboard acknowledgement frees historical capacity even when native delivery is unavailable', async () => {
  const { createHash } = await import('node:crypto');
  const n = await import('./notifications.mjs');
  const state = n.notificationsForAssessment(n.emptyNotifications(), { mode: 'background' }, [good('sample')], at);
  const template = state.alerts[0];
  state.alerts = Array.from({ length: 1000 }, (_, index) => ({ ...template, id: createHash('sha256').update(`synthetic-alert-${index}`).digest('hex'), acknowledgedAt: at, deliveredAt: null }));
  const result = n.notificationsForAssessment(state, { mode: 'background' }, [good('new-exceptional')], later);
  assert.equal(result.alerts.length, 1000);
  assert.equal(result.alerts.filter((item) => item.acknowledgedAt === null).length, 1);
});

test('distinct legacy adverts sharing a privacy-redacted URL still produce distinct new matches', async () => {
  const { writeScanArtifacts } = await import('./scanPipeline.mjs');
  const n = await import('./notifications.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-query-alerts-'));
  try {
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
    fs.writeFileSync(path.join(root, 'data', 'opportunities.json'), JSON.stringify({ updated: '2026-10-25', opportunities: [] }));
    const candidates = [
      { candidateId: 'one', company: 'Synthetic Alpha', role: 'Example Alpha Role', url: 'https://example.test/jobs?id=alpha', source: 'ats' },
      { candidateId: 'two', company: 'Synthetic Beta', role: 'Example Beta Role', url: 'https://example.test/jobs?id=beta', source: 'ats' },
    ];
    const artifacts = writeScanArtifacts(root, { provider: 'codex', mode: 'primary', startedAt: at, sources: { ats: { status: 'healthy', count: 2, jobs: [] } }, candidates, assessmentResult: { assessments: candidates.map((item) => ({ candidateId: item.candidateId, recommendation: 'keep', summary: 'Synthetic fit', mandatoryRequirements: [] })) }, policy: { actionScore: 70, checkScore: 55 } });
    assert.equal(new Set(artifacts.run.reviewed.map((item) => item.sourceUrl)).size, 1, 'privacy projection deliberately removes distinct query values');
    const state = n.notificationsForAssessment(n.emptyNotifications(), { mode: 'active' }, artifacts.run.reviewed, at, { tracker: artifacts.tracker });
    assert.equal(state.pending.length, 2, 'distinct semantic adverts must not collapse at the alert boundary');
    assert.equal(artifacts.tracker.opportunities.filter((entry) => entry.notificationState?.qualified).length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
