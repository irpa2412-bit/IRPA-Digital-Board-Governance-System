"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { EMAIL_SERVICE_UID, createEmailDeliveryIdToken } = require("./emailServiceAuth");

test("mints a Firebase ID token with the dedicated server email identity", async () => {
  const calls=[];
  const token=await createEmailDeliveryIdToken({
    projectId:"irpa-dbg-staging-a73ec",
    auth:{createCustomToken:async(uid,claims)=>{assert.equal(uid,EMAIL_SERVICE_UID);assert.deepEqual(claims,{irpaEmailDeliveryService:true});return "custom-token";}},
    fetchFn:async(url,options)=>{calls.push({url,options});return{ok:true,json:async()=>({localId:EMAIL_SERVICE_UID,idToken:"firebase-id-token"})};}
  });
  assert.equal(token,"firebase-id-token");
  assert.match(calls[0].url,/accounts:signInWithCustomToken/);
  assert.deepEqual(JSON.parse(calls[0].options.body),{token:"custom-token",returnSecureToken:true});
});

test("uses an explicit project Web API key when supplied",async()=>{
  let called="";
  await createEmailDeliveryIdToken({
    env:{FIREBASE_WEB_API_KEY:"public-test-api-key"},
    projectId:"test-project",
    auth:{createCustomToken:async()=> "custom"},
    fetchFn:async(url)=>{called=url;return{ok:true,json:async()=>({localId:EMAIL_SERVICE_UID,idToken:"id"})};}
  });
  assert.match(called,/key=public-test-api-key/);
});

test("fails closed when project configuration is missing",async()=>{
  await assert.rejects(createEmailDeliveryIdToken({
    env:{},projectId:"unknown-project",
    auth:{createCustomToken:async()=> "custom"},
    fetchFn:async()=>{throw new Error("must not fetch");}
  }),/not configured/);
});

test("fails closed when Firebase rejects the custom-token exchange",async()=>{
  await assert.rejects(createEmailDeliveryIdToken({
    env:{FIREBASE_WEB_API_KEY:"test-key"},projectId:"test-project",
    auth:{createCustomToken:async()=> "custom"},
    fetchFn:async()=>({ok:false,json:async()=>({error:{message:"INVALID_CUSTOM_TOKEN"}})})
  }),/could not issue/);
});

test("fails closed if Firebase returns a token for an unexpected UID",async()=>{
  await assert.rejects(createEmailDeliveryIdToken({
    env:{FIREBASE_WEB_API_KEY:"test-key"},projectId:"test-project",
    auth:{createCustomToken:async()=> "custom"},
    fetchFn:async()=>({ok:true,json:async()=>({localId:"wrong-user",idToken:"id"})})
  }),/could not issue/);
});
