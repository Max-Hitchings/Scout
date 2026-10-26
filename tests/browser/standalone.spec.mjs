import { expect, test } from '@playwright/test';
import fs from 'node:fs';

const version = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;
const establishedStatus = {
  bootstrap: false, established: true, ready: true, setupComplete: true, trackerExists: true,
  workspaceRoot: 'SYNTHETIC_WORKSPACE', appRoot: 'SYNTHETIC_APP', appVersion: version,
  config: { locale: 'en-US', currency: 'USD', timezone: 'UTC', profile: { displayName: 'Example Person' }, search: {}, commute: {}, ai: { provider: 'codex' } },
  providers: {}, scanHealth: { healthy: true }, schedule: { enabled: false, configured: false, runs: [] },
  device: { updates: { policy: 'notify' }, startupStatus: { supported: false } }, git: { installed: true },
  sync: { state: 'disabled', enabled: false }, remoteAccess: { state: 'disabled', enabled: false }, requestAccess: 'local', pendingSetupSections: [],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/setup/status', (route) => route.fulfill({ json: establishedStatus }));
});

test('phone CV review requires exact approval and preserves an editable draft', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let approved = 0;
  let status = { state: 'changed', sourcePath: 'SYNTHETIC_EXTERNAL_FILE.md', revision: 'reviewed-revision', versions: [], diff: [{ kind: 'removed', text: 'Old evidence' }, { kind: 'added', text: 'New confirmed evidence' }] };
  await page.route('**/api/cv/living', (route) => route.fulfill({ json: status }));
  await page.route('**/api/cv/living/approve', async (route) => {
    expect(route.request().postDataJSON()).toEqual({ confirmed: true, revision: 'reviewed-revision' });
    approved++;
    status = { ...status, state: 'current', profileReviewPending: true, diff: [] };
    await route.fulfill({ json: status });
  });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.Scout?.state?.cvFiles))).toBe(true);
  await page.getByRole('button', { name: 'CV', exact: true }).click();
  await page.getByText('Living CV — keep a notes file connected', { exact: true }).click();
  await expect(page.getByLabel('CV changes')).toContainText('New confirmed evidence');
  await page.getByRole('button', { name: 'Approve this CV change' }).click();
  expect(approved).toBe(0);
  await page.getByRole('checkbox', { name: 'I reviewed this exact change' }).check();
  await page.getByRole('button', { name: 'Approve this CV change' }).click();
  await expect(page.getByText('No new changes in the source', { exact: true })).toBeVisible();
  expect(approved).toBe(1);
  await expect(page.getByRole('button', { name: 'Review my search preferences' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('phone thumbs-down feedback records a reason and stages a proposal without publishing it', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let recorded;
  await page.route('**/api/feedback-learning', (route) => route.fulfill({ json: { revision: 'feedback-revision', active: { changes: [] } } }));
  await page.route('**/api/feedback', async (route) => {
    recorded = route.request().postDataJSON();
    await route.fulfill({ json: { ok: true, proposed: true, ledger: { revision: 'new-revision' } } });
  });
  await page.goto('/');
  const card = page.locator('#tab-jobs .card[data-id="new-systems-product-2026-07"]');
  await card.click();
  await card.getByRole('button', { name: 'Poor fit' }).click();
  const form = card.getByRole('region', { name: 'Job feedback' });
  await form.getByRole('combobox', { name: 'Reason', exact: true }).selectOption('responsibilities');
  await form.getByLabel('What should Scout know?').fill('The work described is outside the responsibilities I want.');
  await form.getByLabel('What should Scout know?').press('End');
  await form.getByLabel('What should Scout know?').press('Space');
  await expect(form.getByLabel('What should Scout know?')).toHaveValue(/want\. $/);
  await form.getByRole('combobox', { name: 'Use this feedback for' }).selectOption('title');
  await form.getByRole('button', { name: 'Save feedback' }).click();
  await expect(form.getByRole('status')).toContainText('waiting for your review');
  expect(recorded).toMatchObject({ opportunityId: 'new-systems-product-2026-07', decision: 'not-interested', reason: 'responsibilities', learning: { field: 'title' } });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('phone cover-letter edits keep PDF download disabled until the saved draft is rendered again', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let saved;
  const source = '# DRAFT\n\nA truthful synthetic cover letter.';
  await page.route('**/api/cv', (route) => route.fulfill({ json: { applications: [], outreach: ['synthetic-letter'], entries: [], letters: [{ slug: 'synthetic-letter', pdf: true, current: !saved, pdfCurrent: !saved, stale: Boolean(saved) }] } }));
  await page.route('**/api/cv/file**', (route) => route.fulfill({ contentType: 'text/plain', body: source }));
  await page.route('**/api/cv/pdf**', (route) => route.fulfill({ contentType: 'application/pdf', body: '%PDF-1.7\nSynthetic draft PDF body.' }));
  await page.route('**/api/cv/save', async (route) => { saved = route.request().postDataJSON(); await route.fulfill({ json: { ok: true } }); });
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.Scout?.state?.cvFiles))).toBe(true);
  await page.getByRole('button', { name: 'CV', exact: true }).click();
  await page.locator('[data-cv-path="applications/synthetic-letter/outreach.md"]').click();
  await expect(page.getByRole('button', { name: 'download PDF', exact: true })).toBeEnabled();
  const editor = page.locator('#cv-text');
  await editor.fill(source + '\nA reviewed edit.');
  await expect(page.getByRole('button', { name: 'download PDF', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'save changes', exact: true }).click();
  await expect(page.locator('#cv-status')).toContainText('Saved.');
  expect(saved).toMatchObject({ path: 'applications/synthetic-letter/outreach.md', content: source + '\nA reviewed edit.' });
  await expect(page.getByRole('button', { name: 'download PDF', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'render PDF', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});

test('phone reviewed draft flow keeps local-model text editable and requires confirmation before saving', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let saves = 0; let savedText = ''; const source = '# DRAFT\n\nConfirmed synthetic CV experience.';
  await page.route('**/api/cv', (route) => route.fulfill({ json: { applications: [], outreach: [], entries: [], draftCvs: saves ? [{ slug: 'new-systems-product-2026-07', pdf: false, current: false }] : [] } }));
  await page.route('**/api/cv/drafts/generate', (route) => route.fulfill({ json: { operation: { id: 'synthetic-draft', status: 'succeeded', result: { draftId: 'synthetic-draft' } } } }));
  await page.route('**/api/cv/drafts/preview**', (route) => route.fulfill({ json: { opportunityId: 'new-systems-product-2026-07', kind: 'cv', revision: 'synthetic-revision', provider: 'local', markdown: source } }));
  await page.route('**/api/cv/drafts/save', async (route) => {
    const payload = route.request().postDataJSON(); saves++; savedText = payload.markdown;
    expect(payload).toMatchObject({ draftId: 'synthetic-draft', confirmed: true });
    await route.fulfill({ json: { ok: true, path: 'applications/new-systems-product-2026-07/draft-cv.md', slug: 'new-systems-product-2026-07', target: 'draft-cv' } });
  });
  await page.route('**/api/cv/file**', (route) => route.fulfill({ contentType: 'text/plain', body: savedText || source }));
  await page.goto('/');
  await expect.poll(() => page.evaluate(() => Boolean(window.Scout?.state?.cvFiles))).toBe(true);
  await page.getByRole('button', { name: 'CV', exact: true }).click();
  await page.getByRole('button', { name: 'Review CV options' }).click();
  await page.locator('#cv-create-opportunity').selectOption('new-systems-product-2026-07');
  await page.getByRole('button', { name: 'Create reviewed CV draft' }).click();
  await page.getByRole('button', { name: 'Generate draft from confirmed CV facts' }).click();
  await expect(page.getByLabel('Editable draft')).toHaveValue(source);
  await page.getByLabel('Editable draft').fill(source + '\nMy human-reviewed edit.');
  await page.evaluate(() => window.Scout.showUiUpdate());
  await page.getByRole('button', { name: 'Refresh Scout', exact: true }).click();
  await expect(page.locator('#ui-update-banner')).toContainText('Save or discard the application draft first.');
  await expect(page.getByLabel('Editable draft')).toHaveValue(/human-reviewed edit/);
  await page.getByRole('button', { name: 'Save reviewed draft' }).click();
  expect(saves).toBe(0);
  await expect(page.getByLabel('Editable draft')).toHaveValue(/human-reviewed edit/);
  await page.getByRole('checkbox', { name: 'I reviewed the facts and my edits' }).check();
  await page.getByRole('button', { name: 'Save reviewed draft' }).click();
  await expect(page.locator('#cv-text')).toHaveValue(/human-reviewed edit/);
  await expect(page.locator('#cv-status')).toContainText('nothing was sent');
  expect(saves).toBe(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
});
