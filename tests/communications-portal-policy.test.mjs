import test from "node:test";
import assert from "node:assert/strict";
import { publishingGate } from "../drive-gateway/src/communicationsPortalIntegrationGate.mjs";
import { SOCIAL_PROVIDER_MANIFEST, socialProviderStatus, makeManualExport } from "../drive-gateway/src/socialProviderManifest.mjs";
import { selectDueCommunicationItems } from "../drive-gateway/src/communicationsSchedulerPolicy.mjs";

test("publishing remains disabled by default",()=>assert.equal(publishingGate({item:{status:"Approved",approvedBy:"a",approvedAt:"now"},actor:{uid:"b"}}).ok,false));
test("pause switch blocks publication",()=>assert.equal(publishingGate({env:{COMMUNICATIONS_PUBLISHING_ENABLED:"true",COMMUNICATIONS_PAUSE_ALL:"true"},item:{status:"Approved",approvedBy:"a",approvedAt:"now"},actor:{uid:"b"}}).ok,false));
test("approval and author separation required",()=>assert.equal(publishingGate({env:{COMMUNICATIONS_PUBLISHING_ENABLED:"true",COMMUNICATIONS_PAUSE_ALL:"false"},item:{status:"Approved",approvedBy:"a",approvedAt:"now",authorUid:"b"},actor:{uid:"b"}}).ok,false));
test("each social platform reports missing secrets and never auto-publishes",()=>{for(const p of Object.keys(SOCIAL_PROVIDER_MANIFEST)){assert.equal(socialProviderStatus({},p).status,"not_connected");assert.equal(socialProviderStatus({},p).automaticPublishing,false)}});
test("manual export is validated and never published",()=>assert.equal(makeManualExport("x","hello").published,false));
test("scheduler is disabled by default",()=>assert.deepEqual(selectDueCommunicationItems([{status:"Approved",approvedBy:"a",approvedAt:"x",scheduledAt:"2000-01-01"}]).items,[]));
