import test from "node:test";
import assert from "node:assert/strict";
import { resolveSmtpConfig } from "../src/smtpConfig.mjs";

test("uses the environment-specific SMTP host, port, sender and username",()=>{
 const config=resolveSmtpConfig({SMTP_HOST:"smtp.staging.example",SMTP_PORT:"587",SMTP_FROM:"administrator@irpa.or.tz",SMTP_USERNAME:"smtp-user@irpa.or.tz"});
 assert.deepEqual(config,{host:"smtp.staging.example",port:587,from:"administrator@irpa.or.tz",username:"smtp-user@irpa.or.tz"});
});
test("rejects malformed SMTP sender configuration",()=>assert.throws(()=>resolveSmtpConfig({SMTP_FROM:"bad address"}),/valid recipient/));
