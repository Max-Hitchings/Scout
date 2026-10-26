import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { seedWorkspace } from '../ui/lib/workspace.mjs';
import { initializeRecoveryBackup, verifyReviewedRunArchive } from '../ui/lib/recoveryBackup.mjs';
import { saveSyncSettings } from '../ui/lib/workspaceSync.mjs';
import { acquireScanLease, currentLeaseOwner, releaseScanLease } from '../ui/lib/scanLease.mjs';
const app = path.resolve(new URL('../', import.meta.url).pathname);
const stable = (v) => Array.isArray(v) ? `[${v.map(stable).join(',')}]` : v && typeof v === 'object' ? `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}` : JSON.stringify(v);
const hash = (v) => crypto.createHash('sha256').update(stable(v)).digest('hex');
function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-cleanup-cli-'));
  const root = path.join(parent, 'workspace');
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  seedWorkspace(app, root);
  for (let i = 0; i < 22; i++) {
    const runId = `synthetic-run-${String(i).padStart(2, '0')}`;
    const directory = path.join(root, '.scout/runs', runId);
    fs.mkdirSync(path.join(directory, 'artifacts'), { recursive: true });
    const payload = { schemaVersion: 1, outcome: 'complete' };
    const event = { schemaVersion: 1, runId, sequence: 1, eventId: crypto.randomUUID(), type: 'run.completed', recordedAt: `2020-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`, leaseId: 'synthetic-retention', fencingGeneration: 1, stageId: 'finalise', idempotencyKey: `complete-${runId}`, previousHash: null, payloadHash: hash(payload), payload };
    event.eventHash = hash(event);
    fs.writeFileSync(path.join(directory, 'journal.jsonl'), `${stable(event)}\n`);
    fs.writeFileSync(path.join(directory, 'artifacts/result.json'), 'Synthetic retained diagnostic.');
  }
  const key = initializeRecoveryBackup(root, crypto.randomBytes(24).toString('hex'));
  saveSyncSettings(root, { enabled: true, dataKey: key.dataKey.toString('base64url') });
  const env = { ...process.env, SCOUT_WORKSPACE: root, SCOUT_HOUSEHOLD_SETTINGS: path.join(parent, 'household.json'), SCOUT_DEVICE_SETTINGS: path.join(parent, 'device.json') };
  const cli = (...args) => spawnSync(process.execPath, [path.join(app, 'tools/scout.mjs'), 'cleanup', '--workspace', root, ...args], { env, cwd: app, encoding: 'utf8', timeout: 30000 });
  return { root, parent, cli, key };
}
test('actual cleanup CLI lists, reviews and archives only an explicit old selection', (t) => {
  const { root, parent, cli, key } = fixture(t);
  const listing = cli('--plan');
  assert.equal(listing.status, 0, listing.stderr);
  const candidates = JSON.parse(listing.stdout);
  assert.equal(candidates.plan.candidates.length, 2);
  assert.equal(candidates.plan.selected.length, 0);
  const output = path.join(parent, 'reviewed-plan.json');
  const planned = cli('--plan', '--select', 'synthetic-run-00', '--output', output);
  assert.equal(planned.status, 0, planned.stderr);
  const reviewed = JSON.parse(planned.stdout);
  assert.equal(fs.existsSync(path.join(root, '.scout/runs/synthetic-run-00')), true);
  const applied = cli('--apply', output, '--confirm', reviewed.reviewDigest);
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.archivedRuns, 1);
  assert.equal(fs.existsSync(path.join(root, '.scout/runs/synthetic-run-00')), false);
  assert.equal(fs.existsSync(path.join(root, '.scout/runs/synthetic-run-01')), true);
  const archive = verifyReviewedRunArchive(result.archiveFile, key.dataKey);
  assert.equal(archive.runs[0].runId, 'synthetic-run-00');
  const replay = cli('--apply', output, '--confirm', reviewed.reviewDigest);
  assert.equal(replay.status, 0, replay.stderr);
});
test('actual cleanup CLI refuses altered content, wrong confirmation and a live foreign lease', (t) => {
  const { root, parent, cli } = fixture(t);
  const output = path.join(parent, 'reviewed-plan.json');
  const planned = cli('--plan', '--select', 'synthetic-run-00', '--output', output);
  assert.equal(planned.status, 0, planned.stderr);
  const reviewed = JSON.parse(planned.stdout);
  assert.notEqual(cli('--apply', output, '--confirm', 'a'.repeat(64)).status, 0);
  const lease = acquireScanLease(root, currentLeaseOwner(), { kind: 'scan', runId: 'live-synthetic-scan' });
  assert.ok(lease);
  try { assert.notEqual(cli('--apply', output, '--confirm', reviewed.reviewDigest).status, 0); }
  finally { releaseScanLease(lease); }
  const artifact = path.join(root, '.scout/runs/synthetic-run-00/artifacts/result.json');
  fs.writeFileSync(artifact, 'Synthetic diagnostic changed after review.');
  const changed = cli('--apply', output, '--confirm', reviewed.reviewDigest);
  assert.notEqual(changed.status, 0);
  assert.equal(fs.readFileSync(artifact, 'utf8'), 'Synthetic diagnostic changed after review.');
});
