import { normaliseObservation } from '../vacancyObservation.mjs';
import { canonicaliseObservations } from '../vacancyCanonical.mjs';

const count = Number(process.argv[2] || 5000);
const observations = Array.from({ length: count }, (_, index) => normaliseObservation({
  company: `Synthetic Employer ${index}`, providerId: `opening-${index}`,
  url: `https://jobs.example.test/opening-${index}`, title: `Synthetic Role ${index}`,
  description: 'Deliver synthetic services and maintain reliable systems.',
}, { sourceName: 'synthetic', fetchedAt: '2026-10-25T12:00:00.000Z' }));
const start = performance.now();
const startCpu = process.cpuUsage();
const first = canonicaliseObservations(observations);
const initialMs = performance.now() - start;
const second = canonicaliseObservations([...observations].reverse(), { priorVacancies: first.vacancies });
const elapsedMs = performance.now() - start;
const usedCpu = process.cpuUsage(startCpu);
console.log(JSON.stringify({
  count: first.vacancies.length, initialMs, elapsedMs,
  cpuMs: (usedCpu.user + usedCpu.system) / 1000,
  stable: JSON.stringify(second) === JSON.stringify(first),
}));
