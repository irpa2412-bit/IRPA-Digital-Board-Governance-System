import fs from 'node:fs';
import path from 'node:path';
const directory = '.github/workflows';
const files = fs.readdirSync(directory).filter(name => /\.ya?ml$/i.test(name));
const failures = [];
const deployCommand = /firebase(?:-tools(?:@[^\s]+)?)?\s+deploy[^\n]*/i;
for (const name of files) {
  const source = fs.readFileSync(path.join(directory, name), 'utf8');
  const blocks = source.split(/(?=^      - name:)/m);
  for (const block of blocks) {
    const condition = block.split('\n').find(line => line.trimStart().startsWith('if:')) || '';
    const customStagingPublisher = block.includes("node functions/scripts/deploy-staging-firestore-rules.js");
    if (customStagingPublisher &&
        (!condition.includes("github.event_name == 'workflow_dispatch'") ||
         !condition.includes("inputs.confirm_staging_firestore_rules_deployment == 'DEPLOY RULES'"))) {
      failures.push(name + ': custom staging Firestore rules publisher lacks manual workflow_dispatch and exact DEPLOY RULES confirmation.');
    }

    if (!/--only\s+[^\n]*firestore/i.test(block) || !deployCommand.test(block)) continue;
    if (/emulators:exec/i.test(block)) continue;
    const productionTarget = /--project\s+irpa-digital-board-governance(?:\s|$)/i.test(block) || /FIREBASE_SERVICE_ACCOUNT_IRPA_DIGITAL_BOARD_GOVERNANCE/i.test(block);
    const stagingTarget = /irpa-dbg-staging-a73ec|demo-irpa-[\w-]+/i.test(block);
    if (!productionTarget && stagingTarget) {
      if (!condition.includes("github.event_name == 'workflow_dispatch'") ||
          !condition.includes("inputs.confirm_staging_firestore_rules_deployment == 'DEPLOY RULES'")) {
        failures.push(name + ': staging Firestore deployment lacks manual workflow_dispatch and exact DEPLOY RULES confirmation.');
      }
      continue;
    }
    if (!productionTarget) {
      failures.push(name + ': Firestore deploy target is not statically proven production or isolated staging; review and pin the target.');
      continue;
    }
    if (!condition.includes("github.event_name == 'workflow_dispatch'") ||
        !condition.includes("inputs.confirm_production_firestore_rules_deployment == 'DEPLOY RULES'")) {
      failures.push(name + ': production Firestore deployment lacks manual workflow_dispatch and exact DEPLOY RULES confirmation.');
    }
  }
}
if (failures.length) { console.error('FIRESTORE_DEPLOY_TRIGGER_GUARD_FAILED'); console.error(failures.join('\n')); process.exit(1); }
console.log('PASS: every production and staging Firestore publisher is manually dispatched and requires exact DEPLOY RULES confirmation; emulator-only commands are excluded.');
