import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { approveLivingCv, configureLivingCv, livingCvStatus } from './livingCv.mjs';

const original = '# Synthetic CV\n\n' + 'Confirmed experience and evidence. '.repeat(30);
const changed = original + '\n## New evidence\nA confirmed additional responsibility.\n';
function fixture(t) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'scout-living-cv-'));
  const root = path.join(parent, 'workspace');
  fs.mkdirSync(path.join(root, 'cv'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cv', 'master-cv.md'), original);
  const source = path.join(parent, 'source.md');
  fs.writeFileSync(source, changed);
  t.after(() => fs.rmSync(parent, { recursive: true, force: true }));
  return { root, source };
}

test('an external change stays a reviewable diff until the exact source and master are approved', (t) => {
  const { root, source } = fixture(t);
  configureLivingCv(root, source);
  const status = livingCvStatus(root);
  assert.equal(status.state, 'changed');
  assert.ok(status.diff.some((line) => line.kind === 'added' && line.text.includes('New evidence')));
  assert.equal(fs.readFileSync(path.join(root, 'cv/master-cv.md'), 'utf8'), original);
  assert.throws(() => approveLivingCv(root, { revision: status.revision }), /confirm/i);
  const approved = approveLivingCv(root, { revision: status.revision, confirmed: true });
  assert.equal(approved.state, 'current');
  assert.equal(approved.profileReviewPending, true);
  assert.equal(fs.readFileSync(path.join(root, 'cv/master-cv.md'), 'utf8'), changed);
  assert.equal(approved.versions.length, 2);
  assert.equal(fs.readFileSync(path.join(root, 'cv/versions', `${approved.versions[1].id}.md`), 'utf8'), changed);
});

test('source edits, local CV edits and workspace boundaries invalidate an old approval', (t) => {
  const { root, source } = fixture(t);
  configureLivingCv(root, source);
  let revision = livingCvStatus(root).revision;
  fs.appendFileSync(source, '\nAnother confirmed fact.\n');
  assert.throws(() => approveLivingCv(root, { revision, confirmed: true }), /changed|review/i);
  revision = livingCvStatus(root).revision;
  fs.appendFileSync(path.join(root, 'cv/master-cv.md'), '\nA local edit.\n');
  assert.throws(() => approveLivingCv(root, { revision, confirmed: true }), /changed|review/i);
  const other = path.join(path.dirname(root), 'other');
  fs.mkdirSync(other);
  assert.equal(livingCvStatus(other).state, 'disconnected');
  assert.throws(() => configureLivingCv(root, path.join(root, 'cv/master-cv.md')), /external|outside/i);
});

test('JSON sources are bounded Markdown envelopes; invalid or missing sources keep the CV and versions', (t) => {
  const { root, source } = fixture(t);
  const json = source.replace(/md$/, 'json');
  fs.writeFileSync(json, JSON.stringify({ markdown: changed }));
  configureLivingCv(root, json);
  const status = livingCvStatus(root);
  approveLivingCv(root, { revision: status.revision, confirmed: true });
  const versions = livingCvStatus(root).versions;
  fs.writeFileSync(json, JSON.stringify({ unrelated: 'not a CV' }));
  assert.equal(livingCvStatus(root).state, 'unavailable');
  assert.equal(fs.readFileSync(path.join(root, 'cv/master-cv.md'), 'utf8'), changed);
  fs.rmSync(json);
  assert.equal(livingCvStatus(root).state, 'unavailable');
  assert.deepEqual(livingCvStatus(root).versions, versions);
  configureLivingCv(root, null);
  assert.equal(livingCvStatus(root).state, 'disconnected');
  assert.deepEqual(livingCvStatus(root).versions, versions);
});

test('version tampering and symlinked workspace destinations fail closed', (t) => {
  const { root, source } = fixture(t);
  configureLivingCv(root, source);
  let status = livingCvStatus(root);
  approveLivingCv(root, { revision: status.revision, confirmed: true });
  status = livingCvStatus(root);
  fs.writeFileSync(path.join(root, 'cv/versions', `${status.versions[0].id}.md`), 'tampered');
  fs.appendFileSync(source, '\nFurther evidence.\n');
  assert.throws(() => approveLivingCv(root, { revision: livingCvStatus(root).revision, confirmed: true }), /version|digest/i);
  assert.equal(fs.readFileSync(path.join(root, 'cv/master-cv.md'), 'utf8'), changed);
});
