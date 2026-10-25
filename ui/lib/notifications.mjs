import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { atomicWriteFile } from './atomicWrite.mjs';
import { validatePhysicalWorkspacePath } from './physicalPath.mjs';
import { withWorkspaceMutationAuthority } from './workspaceMutationAuthority.mjs';
import { workspaceModePolicy } from './workspaceMode.mjs';

const HASH = /^[a-f0-9]{64}$/;
const BLOCKING = new Set(['sign-in-required', 'network-unavailable', 'rate-limited', 'cli-update-required', 'provider-error']);
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_MATCHES = 10_000;
const MAX_ALERTS = 1_000;
const keys = (value, expected) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...expected].sort().join(',');
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const iso = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(value).toISOString() === value;
const nullableTime = (value) => value === null || iso(value);

export function emptyNotifications() {
  return { schemaVersion: 1, matches: {}, pending: [], digestAfter: null, providerEpisodes: {}, alerts: [] };
}

export function validateNotifications(value) {
  const fail = () => { throw new Error('notification storage has an unsupported schema'); };
  if (!keys(value, ['schemaVersion', 'matches', 'pending', 'digestAfter', 'providerEpisodes', 'alerts'])
    || value.schemaVersion !== 1 || !value.matches || Array.isArray(value.matches)
    || Object.keys(value.matches).length > MAX_MATCHES || !Array.isArray(value.pending)
    || value.pending.length > MAX_MATCHES || new Set(value.pending).size !== value.pending.length
    || !value.pending.every((item) => HASH.test(item)) || !nullableTime(value.digestAfter)
    || !value.providerEpisodes || Array.isArray(value.providerEpisodes)
    || !Array.isArray(value.alerts) || value.alerts.length > MAX_ALERTS) fail();
  for (const [id, item] of Object.entries(value.matches)) {
    if (!HASH.test(id) || !keys(item, ['qualified', 'episode']) || typeof item.qualified !== 'boolean'
      || !Number.isSafeInteger(item.episode) || item.episode < 0) fail();
  }
  for (const [provider, item] of Object.entries(value.providerEpisodes)) {
    if (!['codex', 'claude'].includes(provider) || !keys(item, ['state', 'episode'])
      || !(item.state === null || BLOCKING.has(item.state))
      || !Number.isSafeInteger(item.episode) || item.episode < 0) fail();
  }
  const ids = new Set();
  for (const item of value.alerts) {
    if (!keys(item, ['id', 'kind', 'provider', 'count', 'createdAt', 'deliveredAt', 'acknowledgedAt'])
      || !HASH.test(item.id) || ids.has(item.id) || !['match', 'digest', 'provider'].includes(item.kind)
      || ![null, 'codex', 'claude'].includes(item.provider)
      || (item.kind === 'provider') !== (item.provider !== null)
      || !Number.isSafeInteger(item.count) || item.count < 1 || item.count > MAX_MATCHES
      || !iso(item.createdAt) || !nullableTime(item.deliveredAt) || !nullableTime(item.acknowledgedAt)) fail();
    ids.add(item.id);
  }
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_BYTES) fail();
  return value;
}

export function notificationFile(root) {
  return validatePhysicalWorkspacePath(root, path.join(root, '.scout', 'notifications.json'), 'notification storage');
}

export function readNotifications(root) {
  const file = notificationFile(root);
  if (!fs.existsSync(file)) return emptyNotifications();
  if (fs.statSync(file).size > MAX_BYTES) throw new Error('notification storage needs review');
  let state;
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch { throw new Error('notification storage could not be read'); }
  delete state._scoutMutation;
  return validateNotifications(state);
}

function persist(root, state) {
  validateNotifications(state);
  const file = notificationFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  atomicWriteFile(notificationFile(root), `${JSON.stringify(state)}\n`, { mode: 0o600 });
}

function addAlert(state, kind, identity, at, count = 1, provider = null) {
  if (!iso(at)) throw new TypeError('notification time must be an ISO timestamp');
  const id = hash(`${kind}:${identity}`);
  if (state.alerts.some((item) => item.id === id)) return;
  // Keep unresolved obligations. Only completed historical notifications are disposable.
  while (state.alerts.length >= MAX_ALERTS) {
    const index = state.alerts.findIndex((item) => item.acknowledgedAt && item.deliveredAt);
    if (index < 0) throw new Error('Review older notifications before creating more alerts');
    state.alerts.splice(index, 1);
  }
  state.alerts.push({ id, kind, provider, count, createdAt: at, deliveredAt: null, acknowledgedAt: null });
}

export function flushNotificationDigest(input, config, at) {
  const state = structuredClone(validateNotifications(input));
  const policy = workspaceModePolicy(config);
  if (policy.mode === 'background') {
    state.pending = [];
    state.digestAfter = null;
  } else if (state.pending.length && state.digestAfter && at >= state.digestAfter) {
    addAlert(state, 'digest', state.pending.slice().sort().join(':'), at, state.pending.length);
    state.pending = [];
    state.digestAfter = null;
  }
  return validateNotifications(state);
}

export function notificationsForAssessment(input, config, reviewed, at) {
  const state = flushNotificationDigest(input, config, at);
  const policy = workspaceModePolicy(config);
  for (const item of reviewed || []) {
    const reference = item.vacancyId || item.id;
    if (!reference) continue;
    const id = hash(reference);
    const previous = state.matches[id] || { qualified: false, episode: 0 };
    const qualified = item.outcome === 'kept' && Number.isFinite(item.score)
      && item.score >= policy.triage.actionScore;
    const episode = previous.episode + Number(qualified && !previous.qualified);
    if (!Object.hasOwn(state.matches, id) && Object.keys(state.matches).length >= MAX_MATCHES) {
      throw new Error('Notification match history needs review');
    }
    state.matches[id] = { qualified, episode };
    if (!qualified || previous.qualified) continue;
    if (policy.mode === 'background') addAlert(state, 'match', `${id}:${episode}`, at);
    else {
      if (!state.pending.includes(id)) state.pending.push(id);
      state.digestAfter ||= new Date(Date.parse(at) + policy.digestHours * 3_600_000).toISOString();
    }
  }
  return validateNotifications(state);
}

// Called only inside recordProviderHealth's current fence. It never acquires
// another lease. Write before the health replacement: an interrupted retry
// then sees this episode and cannot issue a duplicate notification.
export function enqueueProviderNotificationUnderFence(root, record) {
  const provider = record?.provider;
  if (!['codex', 'claude'].includes(provider)) throw new TypeError('notification provider is unsupported');
  const blocking = BLOCKING.has(record.state) && record.alert;
  const recovered = ['ready', 'credentials-present-unverified'].includes(record.state)
    && record.remoteAuthBarrier !== true;
  if (!blocking && !recovered) return;
  const state = readNotifications(root);
  const previous = state.providerEpisodes[provider] || { state: null, episode: 0 };
  if (blocking && previous.state !== record.state) {
    const episode = previous.episode + 1;
    addAlert(state, 'provider', `${provider}:${episode}`, record.alert.createdAt, 1, provider);
    state.providerEpisodes[provider] = { state: record.state, episode };
  } else if (recovered && previous.state !== null) {
    state.providerEpisodes[provider] = { state: null, episode: previous.episode };
  } else return;
  persist(root, state);
}

export function markNotification(root, id, action, at = new Date().toISOString()) {
  if (!HASH.test(String(id)) || !['delivered', 'acknowledged'].includes(action) || !iso(at)) {
    throw new TypeError('notification request is invalid');
  }
  return withWorkspaceMutationAuthority(root, { kind: 'notifications', phase: action }, () => {
    const state = readNotifications(root);
    const alert = state.alerts.find((item) => item.id === id);
    if (!alert) throw new Error('notification is unavailable');
    const field = action === 'delivered' ? 'deliveredAt' : 'acknowledgedAt';
    alert[field] ||= at;
    persist(root, state);
    return notificationView(state);
  });
}

export function refreshNotificationDigest(root, config, at = new Date().toISOString()) {
  return withWorkspaceMutationAuthority(root, { kind: 'notifications', phase: 'digest' }, () => {
    const current = readNotifications(root);
    const state = flushNotificationDigest(current, config, at);
    if (JSON.stringify(state) !== JSON.stringify(current)) persist(root, state);
    return notificationView(state);
  });
}

export function notificationView(input) {
  const state = validateNotifications(input);
  const view = (item) => ({
    ...item,
    title: item.kind === 'provider' ? `${item.provider === 'claude' ? 'Claude' : 'Codex'} needs attention`
      : item.kind === 'digest' ? 'Your daily Scout matches' : 'An exceptional match is ready',
    body: item.kind === 'provider' ? 'Open Scout to review the provider warning. Other providers can keep working.'
      : item.kind === 'digest' ? `${item.count} new match${item.count === 1 ? '' : 'es'} to review. Your feedback helps Scout learn what matters.`
        : 'Open Scout to review a newly assessed exceptional match.',
  });
  return {
    alerts: state.alerts.filter((item) => item.acknowledgedAt === null).map(view),
    outbox: state.alerts.filter((item) => item.deliveredAt === null && item.acknowledgedAt === null).map(view),
  };
}
