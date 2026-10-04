import test from "node:test";
import assert from "node:assert/strict";
import { handleSendInvitationEmail } from "../src/invitationEmail.mjs";
import { queueInductionEmail } from "../../functions/queueInductionEmail.mjs";

const quiet = { error() {}, log() {} };
const sleep = async () => {};

function makeEnv() {
  const store = new Map();
  return {
    INVITE_SERVICE_KEY: "test-key",
    IRPA_APP_URL: "https://app.example.test",
    DRIVE_KV: {
      get: async (k) => store.get(k) ?? null,
      put: async (k, v) => void store.set(k, v),
    },
  };
}
function req(body, key = "test-key") {
  return new Request("https://gw.test/api/send-invitation-email", {
    method: "POST", headers: key ? { "x-irpa-service-key": key } : {},
    body: JSON.stringify(body),
  });
}
const good = { to:"a@example.org", name:"Amina", link:"https://app.example.test/?invite=abc" };

test("rejects missing or wrong service key", async () => {
  const smtpSend=async()=>({});
  assert.equal((await handleSendInvitationEmail(req(good,null),makeEnv(),{smtpSend,logger:quiet})).status,401);
  assert.equal((await handleSendInvitationEmail(req(good,"bad"),makeEnv(),{smtpSend,logger:quiet})).status,401);
});
test("fails closed when no service key is configured", async () => {
  const env=makeEnv(); delete env.INVITE_SERVICE_KEY;
  assert.equal((await handleSendInvitationEmail(req(good,"anything"),env,{smtpSend:async()=>({}),logger:quiet})).status,401);
});
test("rejects invalid recipient and header injection", async () => {
  const d={smtpSend:async()=>({}),logger:quiet};
  assert.equal((await handleSendInvitationEmail(req({...good,to:"not-an-email"}),makeEnv(),d)).status,400);
  assert.equal((await handleSendInvitationEmail(req({...good,to:"a@example.org\r\nBcc: x@y.z"}),makeEnv(),d)).status,400);
  assert.equal((await handleSendInvitationEmail(req({...good,name:"Bob\r\nBcc: x@y.z"}),makeEnv(),d)).status,400);
});
test("rejects links to other origins", async () => {
  assert.equal((await handleSendInvitationEmail(req({...good,link:"https://evil.test/?invite=abc"}),makeEnv(),{smtpSend:async()=>({}),logger:quiet})).status,400);
});
test("sends once, escapes HTML, returns message id", async () => {
  const calls=[]; const smtpSend=async(_env,msg)=>{calls.push(msg);return{messageId:"m-1"}};
  const res=await handleSendInvitationEmail(req({...good,name:"<b>Eve</b>"}),makeEnv(),{smtpSend,logger:quiet});
  assert.equal(res.status,200); assert.equal((await res.json()).messageId,"m-1"); assert.equal(calls.length,1);
  assert.ok(!calls[0].html.includes("<b>Eve</b>")); assert.ok(calls[0].html.includes("&lt;b&gt;Eve&lt;/b&gt;"));
});
test("retries after a provider failure then succeeds", async () => {
  let n=0; const smtpSend=async()=>{if(++n===1)throw new Error("boom");return{messageId:"m-2"}};
  assert.equal((await handleSendInvitationEmail(req(good),makeEnv(),{smtpSend,logger:quiet,sleep})).status,200); assert.equal(n,2);
});
test("returns 502 after final provider failure", async () => {
  let n=0; const smtpSend=async()=>{n++;throw new Error("down")};
  assert.equal((await handleSendInvitationEmail(req(good),makeEnv(),{smtpSend,logger:quiet,sleep})).status,502); assert.equal(n,3);
});
test("rate limits repeated sends to one address", async () => {
  const env=makeEnv(), d={smtpSend:async()=>({messageId:"x"}),logger:quiet,sleep};
  for(let i=0;i<5;i++) assert.equal((await handleSendInvitationEmail(req(good),env,d)).status,200);
  assert.equal((await handleSendInvitationEmail(req(good),env,d)).status,429);
});
function fakeDb(){const docs=new Map();return{docs,collection:c=>({doc:id=>({set:async d=>void docs.set(`${c}/${id}`,{...d}),update:async d=>void docs.set(`${c}/${id}`,{...docs.get(`${c}/${id}`),...d})})})}};
const base=db=>({db,invitationId:"INV-1",recipientEmail:"a@example.org",recipientName:"Amina",link:"https://app.example.test/?invite=abc",invitedByUid:"u1"});
const fenv={GATEWAY_URL:"https://gw.test",INVITE_SERVICE_KEY:"k"};
test("queueInductionEmail marks Sent on success",async()=>{const db=fakeDb();const fetchFn=async()=>({ok:true,status:200,json:async()=>({ok:true,messageId:"m-9"})});const out=await queueInductionEmail(base(db),{fetchFn,env:fenv,logger:quiet,sleep});assert.equal(out.status,"Sent");assert.equal(db.docs.get("emailQueue/INV-1").status,"Sent")});
test("queueInductionEmail retries 5xx then marks Failed",async()=>{const db=fakeDb();let n=0;const fetchFn=async()=>{n++;return{ok:false,status:502,json:async()=>({})}};const out=await queueInductionEmail(base(db),{fetchFn,env:fenv,logger:quiet,sleep});assert.equal(out.status,"Failed");assert.equal(n,3);assert.equal(db.docs.get("emailQueue/INV-1").status,"Failed")});
test("queueInductionEmail does not retry 4xx",async()=>{const db=fakeDb();let n=0;const fetchFn=async()=>{n++;return{ok:false,status:400,json:async()=>({})}};const out=await queueInductionEmail(base(db),{fetchFn,env:fenv,logger:quiet,sleep});assert.equal(out.status,"Failed");assert.equal(n,1)});
