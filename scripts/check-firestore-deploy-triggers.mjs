import fs from 'node:fs';
const files = ['.github/workflows/firebase-deploy.yml', '.github/workflows/firebase-cli-deploy.yml'];
const required = "github.event_name == 'workflow_dispatch' && inputs.confirm_production_firestore_rules_deployment == 'DEPLOY'";
const failures = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  const blocks = text.split(/(?=^      - name:)/m);
  for (const block of blocks) {
    if (!block.includes('--only firestore')) continue;
    const ifLine = block.split('\n').find(line => line.trimStart().startsWith('if:')) || '';
    if (!ifLine.includes(required)) failures.push(file + ': unguarded Firestore deploy step');
  }
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('PASS: every production Firestore deploy step requires manual workflow_dispatch and exact DEPLOY.');
