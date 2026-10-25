import assert from 'node:assert/strict';
import test from 'node:test';
import { sameUnderlyingJob } from './jobIdentity.mjs';
import { vacancyContentFingerprint } from './vacancyCanonical.mjs';
import { decideVacancyLifecycle, lifecycleRecords, partitionVacanciesForAssessment } from './vacancyLifecycle.mjs';

const vacancy = {
  vacancyId: 'vacancy-1',
  title: { value: 'Platform Engineer', provenance: 'explicit-source' },
  employer: { value: 'Acme', provenance: 'explicit-source' },
  location: { value: 'London', provenance: 'explicit-source' },
  description: 'Operate reliable services and improve production resilience.',
};

test('new and materially changed vacancies are revalidated, re-ranked and assessed', () => {
  assert.deepEqual(decideVacancyLifecycle(null, vacancy), {
    change: 'new',
    revalidate: true,
    rerank: true,
    reassess: true,
    skipAssessment: false,
    reason: 'new-vacancy',
  });

  const previous = {
    ...vacancy,
    description: 'Maintain the existing service.',
    outcome: 'provider_discarded',
    profileId: 'profile-old',
  };
  const decision = decideVacancyLifecycle(previous, vacancy, { profileId: 'profile-old' });
  assert.equal(decision.change, 'material');
  assert.equal(decision.reassess, true);
  assert.equal(decision.skipAssessment, false);
  assert.equal(decision.reason, 'material-change');
});

test('an unchanged rejected vacancy is revalidated but does not consume assessment capacity', () => {
  const previous = {
    ...vacancy,
    outcome: 'below_threshold',
    profileId: 'profile-current',
  };
  assert.deepEqual(
    decideVacancyLifecycle(previous, vacancy, { profileId: 'profile-current' }),
    {
      change: 'unchanged',
      revalidate: true,
      rerank: false,
      reassess: false,
      skipAssessment: true,
      reason: 'unchanged-rejection',
    },
  );
});

test('a same-title URL-less opening with a different provider identity never inherits rejection', () => {
  const previous = {
    ...vacancy,
    vacancyId: 'vacancy-ref-semantic',
    sourceReferences: [{ source: 'ats', providerId: 'opening-1', url: '' }],
    outcome: 'below_threshold',
    profileId: 'profile-current',
  };
  const current = {
    ...vacancy,
    vacancyId: 'vacancy-ref-semantic',
    sourceReferences: [{ source: 'ats', providerId: 'opening-2', url: '' }],
  };
  const result = partitionVacanciesForAssessment([current], [previous], {
    profileId: 'profile-current',
  });
  assert.equal(result.skipped.length, 0);
  assert.equal(result.eligible[0].lifecycle.reason, 'new-vacancy');
});

test('profile, scoring and assessment changes have distinct rerank and reassess behaviour', () => {
  const previous = {
    ...vacancy,
    outcome: 'below_threshold',
    profileId: 'profile-old',
  };
  const profile = decideVacancyLifecycle(previous, vacancy, { profileId: 'profile-new' });
  assert.equal(profile.rerank, true);
  assert.equal(profile.reassess, true);
  assert.equal(profile.reason, 'profile-change');

  const scoring = decideVacancyLifecycle(previous, vacancy, {
    profileId: 'profile-old',
    scoringChanged: true,
  });
  assert.equal(scoring.rerank, true);
  assert.equal(scoring.reassess, false);
  assert.equal(scoring.skipAssessment, true);
  assert.equal(scoring.reason, 'scoring-change');

  const assessment = decideVacancyLifecycle(previous, vacancy, {
    profileId: 'profile-old',
    assessmentChanged: true,
  });
  assert.equal(assessment.rerank, false);
  assert.equal(assessment.reassess, true);
  assert.equal(assessment.skipAssessment, false);
  assert.equal(assessment.reason, 'assessment-change');
});

test('reopened vacancies are reassessed even after a prior rejection', () => {
  const previous = {
    ...vacancy,
    status: 'closed',
    outcome: 'mandatory_unmet',
    profileId: 'profile-current',
  };
  const current = { ...vacancy, status: 'open' };
  const decision = decideVacancyLifecycle(previous, current, { profileId: 'profile-current' });
  assert.equal(decision.change, 'reopened');
  assert.equal(decision.reassess, true);
  assert.equal(decision.reason, 'reopened-vacancy');
});

test('a resurfaced legacy rejection is re-ranked and reassessed once under the published profile', () => {
  const previous = {
    ...vacancy,
    outcome: 'below_threshold',
    profileId: null,
  };
  const decision = decideVacancyLifecycle(previous, vacancy, { profileId: 'profile-current' });

  assert.deepEqual(decision, {
    change: 'unchanged',
    revalidate: true,
    rerank: true,
    reassess: true,
    skipAssessment: false,
    reason: 'legacy-profile-rerank',
  });

  const currentDecision = decideVacancyLifecycle(
    { ...previous, profileId: 'profile-current' },
    vacancy,
    { profileId: 'profile-current' },
  );
  assert.equal(currentDecision.reason, 'unchanged-rejection');
  assert.equal(currentDecision.skipAssessment, true);
});

test('a distinct same-source provider reference cannot inherit an earlier rejection', () => {
  const previous = {
    ...vacancy,
    vacancyId: 'vacancy-ref-earlier',
    sourceReferences: [{ source: 'provider-a', providerId: 'opening-1', url: '' }],
    outcome: 'below_threshold',
    profileId: 'profile-current',
  };
  const current = {
    ...vacancy,
    vacancyId: 'vacancy-ref-later',
    sourceReferences: [{ source: 'provider-a', providerId: 'opening-2', url: '' }],
  };
  const result = partitionVacanciesForAssessment([current], [previous], {
    profileId: 'profile-current',
  });
  assert.equal(result.skipped.length, 0);
  assert.equal(result.eligible[0].lifecycle.reason, 'new-vacancy');
});

test('a different learning version re-ranks an unchanged rejection but never assesses it again', () => {
  const previous = {
    ...vacancy, outcome: 'below_threshold', profileId: 'profile-current', learningVersionId: 'learning-a',
  };
  const options = { profileId: 'profile-current' };

  const changed = decideVacancyLifecycle(previous, vacancy, { ...options, learningVersionId: 'learning-b' });
  assert.deepEqual(
    [changed.reason, changed.rerank, changed.reassess, changed.skipAssessment],
    ['scoring-change', true, false, true],
  );
  const same = decideVacancyLifecycle(previous, vacancy, { ...options, learningVersionId: 'learning-a' });
  assert.equal(same.reason, 'unchanged-rejection');
  const unrecorded = decideVacancyLifecycle(
    { ...previous, learningVersionId: undefined }, vacancy, { ...options, learningVersionId: 'learning-b' },
  );
  assert.equal(unrecorded.reason, 'unchanged-rejection');
});

test('lifecycle records give the change and reason for every vacancy with an earlier decision', () => {
  const rejected = {
    ...vacancy, outcome: 'below_threshold', profileId: 'profile-current', learningVersionId: 'learning-a',
  };
  const fresh = { ...vacancy, vacancyId: 'vacancy-2', canonicalUrl: 'https://example.test/two', title: { value: 'Other Role' } };
  const partition = partitionVacanciesForAssessment([vacancy, fresh], [rejected], {
    profileId: 'profile-current', learningVersionId: 'learning-a',
  });

  assert.deepEqual(lifecycleRecords(partition), [
    { vacancyId: 'vacancy-1', change: 'unchanged', reason: 'unchanged-rejection' },
  ]);
});

test('indexed history lookup picks the same earliest matching decision as comparing every record', () => {
  const byUrl = { ...vacancy, vacancyId: 'by-url', employer: { value: 'Different' }, title: { value: 'Different' }, description: '', canonicalUrl: 'https://example.test/job-1' };
  const byProvider = { ...vacancy, vacancyId: 'by-provider', employer: { value: 'Another' }, title: { value: 'Another' }, description: '', sourceReferences: [{ source: 'ats', providerId: 'opening-9', url: '' }] };
  const unmatched = { ...vacancy, vacancyId: 'unmatched', employer: { value: 'Nobody' }, title: { value: 'Nothing' }, description: '' };
  // Each target record carries the fingerprint of the vacancy it should match, so a skip proves the right record was chosen.
  const rejection = (extra) => ({ outcome: 'below_threshold', profileId: 'profile-current', ...extra });
  const history = [
    ...Array.from({ length: 1500 }, (_, index) => rejection({
      vacancyId: `filler-${index}`, company: `Filler ${index}`, role: 'Unrelated Role',
      url: `https://example.test/filler-${index}`,
    })),
    rejection({ vacancyId: 'same-employer-earlier', company: 'Acme', role: 'Platform Engineer', description: vacancy.description, contentFingerprint: vacancyContentFingerprint(vacancy) }),
    rejection({ vacancyId: 'shared-url-later', company: 'Other', role: 'Other', url: 'https://example.test/job-1', contentFingerprint: vacancyContentFingerprint(byUrl) }),
    rejection({ vacancyId: 'shared-provider', company: 'Elsewhere', role: 'Elsewhere', sourceReferences: [{ source: 'ats', providerId: 'opening-9', url: '' }], contentFingerprint: vacancyContentFingerprint(byProvider) }),
  ];
  const candidates = [vacancy, byUrl, byProvider, unmatched];

  const expected = candidates.map((candidate) => history.find((entry) => sameUnderlyingJob(entry, candidate))?.vacancyId ?? null);
  assert.deepEqual(expected, ['same-employer-earlier', 'shared-url-later', 'shared-provider', null]);

  const { skipped, eligible } = partitionVacanciesForAssessment(candidates, history, { profileId: 'profile-current' });
  assert.deepEqual(skipped.map((item) => item.vacancyId), ['vacancy-1', 'by-url', 'by-provider']);
  assert.deepEqual(eligible.map((item) => [item.vacancyId, item.lifecycle.reason]), [['unmatched', 'new-vacancy']]);
});
