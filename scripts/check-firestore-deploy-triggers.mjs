import fs from 'node:fs';
import path from 'node:path';
const directory = '.github/workflows';
const files = fs.readdirSync(directory).filter(name => /\.ya?ml$/i.test(name));
const failures = [];
for (const name of files) {
  const source = fs.readFileSync(path.join(directory, name), 'utf8');
  const blocks = source.split(/(?=^      - name:)/m);
  for (const block of blocks) {
    if (!/--only\s+firestore(?:[: ,]|$)/i.test(block)) continue;
    const condition = block.split('\n').find(line => line.trimStart().startsWith('if:')) || '';
    if (!condition.includes("github.event_name == 'workflow_dispatch'") || !condition.includes("inputs.confirm_production_firestore_rules_deployment == 'DEPLOY'")) {
      failures.push(name + ': Firestore deployment step lacks manual workflow_dispatch and exact DEPLOY confirmation.');
    }
  }
}
if (failures.length) { console.error('FIRESTORE_DEPLOY_TRIGGER_GUARD_FAILED'); console.error(failures.join('\n')); process.exit(1); }
console.log('PASS: every detected Firestore deployment step across all workflows requires manual workflow_dispatch and exact DEPLOY confirmation.');
