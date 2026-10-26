// Installed-artifact acceptance boundary: never contacts an account or network.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const args = process.argv.slice(2);
const directory = path.dirname(fileURLToPath(import.meta.url));
if (args.includes('--version')) console.log('codex synthetic-native-acceptance');
else if (args.join(' ') === 'login status') console.log('Signed in to synthetic acceptance provider');
else if (args.includes('--help')) console.log('--output-schema');
else if (args[0] === 'debug') process.exitCode = 2;
else if (args[0] === 'exec') {
  let input = '';
  process.stdin.setEncoding('utf8').on('data', (chunk) => { input += chunk; });
  process.stdin.on('end', () => {
    const schema = JSON.parse(fs.readFileSync(args[args.indexOf('--output-schema') + 1], 'utf8'));
    let value = { ready: true };
    if (schema.properties?.profile) value = JSON.parse(fs.readFileSync(path.join(directory, 'proposal.json'), 'utf8'));
    else if (schema.properties?.assessments) {
      const context = JSON.parse(input.split('\n\n').at(-1));
      value = { assessments: context.candidates.map(({ candidateId }) => ({
        candidateId, summary: 'A synthetic installed-app match.',
        responsibilityFit: { rating: 'strong', advertEvidence: 'Deliver reliable synthetic systems.',
          profileEvidence: 'Delivered reliable synthetic systems.', explanation: 'The synthetic evidence aligns.' },
        mandatoryRequirements: [], transferableExperience: [], uncertainties: [],
        strengths: [{ point: 'Direct synthetic delivery evidence.', advertEvidence: 'Deliver reliable synthetic systems.', profileEvidence: 'Delivered reliable synthetic systems.' }],
        concerns: [], recommendation: 'keep',
      })) };
    }
    fs.appendFileSync(path.join(directory, 'calls.jsonl'), `${JSON.stringify({ kind: schema.properties?.profile ? 'onboarding' : schema.properties?.assessments ? 'assessment' : 'health', pid: process.pid })}\n`);
    console.log(JSON.stringify({ type: 'thread.started', thread_id: 'synthetic-install-session' }));
    console.log(JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: JSON.stringify(value) } }));
    console.log(JSON.stringify({ type: 'turn.completed', usage: {} }));
  });
} else { console.error('Unexpected acceptance provider invocation'); process.exitCode = 82; }
