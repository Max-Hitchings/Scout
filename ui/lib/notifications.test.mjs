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
