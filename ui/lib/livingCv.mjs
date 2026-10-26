import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from './atomicWrite.mjs';
import { validatePhysicalWorkspacePath } from './physicalPath.mjs';
import { withWorkspaceMutationAuthority } from './workspaceMutationAuthority.mjs';

const MAX_BYTES = 256 * 1024;
const MAX_VERSIONS = 256;
const digest = (text) => createHash('sha256').update(text).digest('hex');
const local = (root, relative) => validatePhysicalWorkspacePath(root, path.join(root, relative), 'Living CV');
const master = (root) => local(root, 'cv/master-cv.md');
const configFile = (root) => local(root, 'cv/living-cv.json');

function readConfig(root) {
  const file = configFile(root);
  if (!fs.existsSync(file)) return { schemaVersion: 1, sourcePath: null, profileReviewPending: false };
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schemaVersion !== 1 || (value.sourcePath !== null && typeof value.sourcePath !== 'string')) throw new Error('Living CV configuration is invalid.');
  return value;
}

function sourceFile(root, value) {
  if (typeof value !== 'string' || value.includes('\0') || !path.isAbsolute(value) || !/\.(md|markdown|json)$/i.test(value)) throw new Error('Choose an absolute path to an external Markdown or JSON file.');
  const file = path.resolve(value);
  const relative = path.relative(fs.realpathSync(root), fs.realpathSync(file));
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) throw new Error('The source must be outside this workspace. Scout only reads the external file.');
  if (fs.lstatSync(file).isSymbolicLink()) throw new Error('Choose the original source file rather than a symbolic link.');
  return file;
}

function readSource(root, filename) {
  const file = sourceFile(root, filename);
  const handle = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  let raw;
  try {
    const stat = fs.fstatSync(handle);
    if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('The source must be a regular file of at most 256 KiB.');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    const count = fs.readSync(handle, buffer, 0, buffer.length, 0);
    if (count > MAX_BYTES) throw new Error('The source is too large.');
    raw = buffer.subarray(0, count).toString('utf8');
  } finally { fs.closeSync(handle); }
  let markdown = raw;
  if (/\.json$/i.test(file)) {
    const envelope = JSON.parse(raw);
    if (!envelope || typeof envelope.markdown !== 'string' || Object.keys(envelope).some((key) => key !== 'markdown')) throw new Error('JSON CV sources must contain only a markdown string.');
    markdown = envelope.markdown;
  }
  if (Buffer.byteLength(markdown.trim(), 'utf8') < 500 || markdown.includes('\0')) throw new Error('The source CV is empty or incomplete; include at least 500 bytes of confirmed CV text.');
  return { markdown, sourceDigest: digest(raw) };
}

export function cvLineDiff(before, after) {
  const previous = before.split(/\r?\n/);
  const next = after.split(/\r?\n/);
  let start = 0;
  while (start < Math.min(previous.length, next.length) && previous[start] === next[start]) start++;
  let end = 0;
  while (end < Math.min(previous.length, next.length) - start && previous.at(-end - 1) === next.at(-end - 1)) end++;
  const lines = [
    ...previous.slice(Math.max(0, start - 2), start).map((text) => ({ kind: 'context', text })),
    ...previous.slice(start, end ? -end : undefined).map((text) => ({ kind: 'removed', text })),
    ...next.slice(start, end ? -end : undefined).map((text) => ({ kind: 'added', text })),
    ...next.slice(next.length - end, next.length - end + 2).map((text) => ({ kind: 'context', text })),
  ];
  // Never offer approval for a silently truncated diff.
  if (lines.length > 4000) throw new Error('This change is too large to review here. Reduce it to fewer than 4,000 changed lines.');
  return lines;
}

function versions(root, { verify = false } = {}) {
  const directory = local(root, 'cv/versions');
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory).filter((name) => /^[a-f0-9]{64}\.md$/.test(name)).map((name) => {
    const file = local(root, `cv/versions/${name}`);
    if (verify && digest(fs.readFileSync(file)) !== name.slice(0, -3)) throw new Error('An immutable CV version failed its digest check. Existing CV kept.');
    return { id: name.slice(0, -3), savedAt: fs.statSync(file).mtime.toISOString() };
  }).sort((a, b) => a.savedAt.localeCompare(b.savedAt) || a.id.localeCompare(b.id));
}

export function livingCvStatus(root) {
  const config = readConfig(root);
  const result = { ...config, versions: versions(root), state: 'disconnected', revision: null, diff: [] };
  if (!config.sourcePath) return result;
  try {
    const current = fs.existsSync(master(root)) ? fs.readFileSync(master(root), 'utf8') : '';
    const source = readSource(root, config.sourcePath);
    return {
      ...result,
      state: current === source.markdown ? 'current' : 'changed',
      revision: digest(JSON.stringify([config, source.sourceDigest, digest(current)])),
      sourceDigest: source.sourceDigest,
      diff: current === source.markdown ? [] : cvLineDiff(current, source.markdown),
    };
  } catch {
    return { ...result, state: 'unavailable', message: 'The source cannot be read as a complete Markdown CV. Check the path, permissions, size and JSON format. Your saved CV is unchanged.' };
  }
}

export function readLivingCvVersion(root, id) {
  if (!/^[a-f0-9]{64}$/.test(id || '')) throw new Error('Invalid CV version.');
  const content = fs.readFileSync(local(root, `cv/versions/${id}.md`), 'utf8');
  if (digest(content) !== id) throw new Error('CV version failed its digest check.');
  return content;
}

export function configureLivingCv(root, sourcePath) {
  return withWorkspaceMutationAuthority(root, { kind: 'living-cv-config', phase: 'configure-source' }, () => {
    const config = readConfig(root);
    if (sourcePath !== null) readSource(root, sourcePath);
    atomicWriteFile(configFile(root), JSON.stringify({ ...config, sourcePath: sourcePath === null ? null : path.resolve(sourcePath) }) + '\n', { mode: 0o600 });
    return livingCvStatus(root);
  });
}

export function approveLivingCv(root, { revision, confirmed } = {}) {
  if (confirmed !== true) throw new Error('Confirm the exact CV diff before approval.');
  return withWorkspaceMutationAuthority(root, { kind: 'living-cv-approval', phase: 'approve-source' }, () => {
    const status = livingCvStatus(root);
    if (status.state !== 'changed' || !revision || revision !== status.revision) throw new Error('The source or master CV changed. Review the new diff before approval.');
    const config = readConfig(root);
    const source = readSource(root, config.sourcePath);
    const previous = fs.existsSync(master(root)) ? fs.readFileSync(master(root), 'utf8') : '';
    // Bind a second source read to what the person actually reviewed.
    if (digest(JSON.stringify([config, source.sourceDigest, digest(previous)])) !== revision) throw new Error('The source or CV changed. Review it again.');
    const history = versions(root, { verify: true });
    const values = [...new Set([previous, source.markdown])];
    const additions = values.filter((text) => !history.some(({ id }) => id === digest(text)));
    if (history.length + additions.length > MAX_VERSIONS) throw new Error('CV version history is full. Archive it before approving another change.');
    for (const content of additions) atomicWriteFile(local(root, `cv/versions/${digest(content)}.md`), content, { mode: 0o600 });
    atomicWriteFile(master(root), source.markdown, { mode: 0o600 });
    atomicWriteFile(configFile(root), JSON.stringify({ ...config, profileReviewPending: true }) + '\n', { mode: 0o600 });
    return livingCvStatus(root);
  });
}
