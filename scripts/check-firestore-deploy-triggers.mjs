import fs from 'node:fs';
import path from 'node:path';
const directory = '.github/workflows';
const files = fs.readdirSync(directory).filter(name => /\\.ya?ml$/i.test(name));
const failures = [];
const deployCommand = /(?:firebase(?:-tools(?:@[^\\s]+)?)?\\s+deploy|firebase\\s+deploy)[^\\n]*/i;
for (const name of files) {
  const source = fs.readFileSync(path.join(directory, name), 'utf8');
  const blocks = source.split(/(?=^      - name:)/m);
  for (const block of blocks) {
    if (!/--only\\s+[^\\n]*firestore/i.test(block) || !deployCommand.test(block)) continue;
    // Emulator commands are tests, not publication. Non-production deployments must
    // be explicitly pinned to the isolated staging project in the same step.
    if (/emulators:exec/i.test(block)) continue;
    const productionTarget = /--project\\s+irpa-digital-board-governance(?:\\s|$)/i.test(block) || /FIREBASE_SERVICE_ACCOUNT_IRPA_DIGITAL_BOARD_GOVERNANCE/i.test(block);
    const stagingTarget = /irpa-dbg-staging-a73ec|demo-irpa-[\\w-]+/i.test(block);
    if (!productionTarget && stagingTarget) continue;
    if (!productionTarget) {
      failures.push(name + ': Firestore deploy target is not statically proven production or isolated staging; review and pin the target.');
      continue;
    }
    const condition = block.split('\\n').find(line => line.trimStart().startsWith('if:')) || '';
    if (!condition.includes(\"github.event_name == 'workflow_dispatch'\") || !condition.includes(\"inputs.confirm_production_firestore_rules_deployment == 'DEPLOY'\")) {
      failures.push(name + ': production Firestore deployment lacks manual workflow_dispatch and exact DEPLOY confirmation.');
    }
  }
}
if (failures.length) { console.error('FIRESTORE_DEPLOY_TRIGGER_GUARD_FAILED'); console.error(failures.join('\\n')); process.exit(1); }
console.log('PASS: every production Firestore deployment command is manually dispatched and requires exact DEPLOY confirmation; emulator and explicitly isolated staging commands are excluded.');
