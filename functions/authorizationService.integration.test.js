const assert=require("assert");
const {initializeApp,getApps}=require("firebase-admin/app");
const {getFirestore}=require("firebase-admin/firestore");

if(!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("FIRESTORE_EMULATOR_HOST is required.");
if(!getApps().length) initializeApp({projectId:"irpa-authorization-emulator"});
const db=getFirestore();
const service=require("./authorizationService");

const ADMIN="admin-test";
const TARGET="member-test";

async function clear(){
  for(const collection of ["adminProfiles","members","employees","authorizationGrants","authorizationDecisions","audit"]){
    const snap=await db.collection(collection).get();
    const batch=db.batch();
    snap.docs.forEach(d=>batch.delete(d.ref));
    if(snap.size) await batch.commit();
  }
}

(async()=>{
  await clear();
  await db.collection("adminProfiles").doc(ADMIN).set({
    uid:ADMIN,email:"admin@test.irpa.or.tz",name:"Test Administrator",role:"Administrator",active:true
  });
  await db.collection("members").doc(TARGET).set({
    uid:TARGET,email:"member@test.irpa.or.tz",name:"Test Member",role:"Field Department",status:"Active"
  });

  const permission="document.view";
  const reason="Controlled authorization service integration test.";

  const denied=await service.authorize({
    uid:TARGET,
    action:permission,
    auditDecision:true
  });
  assert.equal(denied.allow,false);
  assert.equal(denied.reason,"PERMISSION_DENIED");

  const granted=await service.grantPermission({
    actorUid:ADMIN,targetUid:TARGET,permission,scope:{module:"Documents"},reason
  });
  assert.equal(granted.ok,true);
  assert.equal(granted.alreadyActive,false);

  const duplicate=await service.grantPermission({
    actorUid:ADMIN,targetUid:TARGET,permission,scope:{module:"Documents"},reason
  });
  assert.equal(duplicate.ok,true);
  assert.equal(duplicate.alreadyActive,true);

  const allowed=await service.authorize({
    uid:TARGET,
    action:permission,
    resource:{id:"doc-test"},
    auditDecision:true
  });
  assert.equal(allowed.allow,true);
  assert.equal(allowed.reason,"PERMISSION_GRANTED");

  const revoked=await service.revokePermission({
    actorUid:ADMIN,targetUid:TARGET,permission,scope:{module:"Documents"},reason:"Controlled revocation test."
  });
  assert.equal(revoked.ok,true);
  assert.equal(revoked.alreadyRevoked,false);

  const revokedAgain=await service.revokePermission({
    actorUid:ADMIN,targetUid:TARGET,permission,scope:{module:"Documents"},reason:"Idempotency test."
  });
  assert.equal(revokedAgain.ok,true);
  assert.equal(revokedAgain.alreadyRevoked,true);

  const deniedAgain=await service.authorize({
    uid:TARGET,
    action:permission,
    auditDecision:true
  });
  assert.equal(deniedAgain.allow,false);
  assert.equal(deniedAgain.reason,"PERMISSION_DENIED");

  await assert.rejects(
    service.grantPermission({actorUid:ADMIN,targetUid:TARGET,permission,scope:{module:"Other"}}),
    error=>error.code==="invalid-argument"
  );
  await assert.rejects(
    service.grantPermission({actorUid:ADMIN,targetUid:ADMIN,permission,reason}),
    error=>error.code==="failed-precondition"
  );

  const grants=(await db.collection("authorizationGrants").get()).docs.map(d=>d.data());
  assert.equal(grants.length,1);
  assert.equal(grants[0].status,"Revoked");

  const audits=await db.collection("audit").where("category","==","AUTHORIZATION").get();
  assert(audits.size>=2);

  console.log("AUTHORIZATION_SERVICE_EMULATOR_TEST_OK");
})().catch(error=>{
  console.error(error);
  process.exitCode=1;
});
