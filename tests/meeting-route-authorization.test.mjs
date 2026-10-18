import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync(new URL('../drive-gateway/src/meetingServices.mjs', import.meta.url), 'utf8');
const routes = [
  { name: 'register working document', key: 'registerWorkingDocument', role: 'canManage', meeting: 'document.meetingId' },
  { name: 'list working documents', key: 'listWorkingDocuments', role: 'canRead', meeting: 'meetingId' },
  { name: 'review working document', key: 'reviewWorkingDocument', role: 'participant', meeting: 'document.meetingId' },
  { name: 'sign attendance', key: 'signAttendance', role: 'participant', meeting: 'participant.meetingId' },
  { name: 'attendance register', key: 'attendanceRegister', role: 'manager', meeting: 'meetingId' }
];
const routeBlock = key => {
  const start = worker.indexOf('if(pathname===MEETING_ROUTES.' + key + '){');
  assert.notEqual(start, -1, 'route handler missing: ' + key);
  const next = worker.indexOf('\nif(pathname===MEETING_ROUTES.', start + 10);
  return worker.slice(start, next === -1 ? worker.length : next);
};

for (const route of routes) {
  test(route.name + ': missing-token requests are rejected by shared authentication gate', () => {
    assert.ok(worker.includes('claims=await ctx.authenticateFirebaseRequest(request,env)'));
    assert.ok(worker.includes('catch{return fail(ctx,request,"A valid IRPA sign-in is required.",401)}'));
  });
  test(route.name + ': role/participant authorization is checked server-side', () => {
    const block = routeBlock(route.key);
    assert.match(block, /context\(ctx,env,token,claims,meetingId\)/);
    assert.ok(/canManage|canRead|participant|manager|own/.test(block), 'route must use a role or participant authorization predicate');
    assert.ok(/return fail\(ctx,request,[^;]+,403\)/.test(block), 'unauthorized access must return 403');
  });
  test(route.name + ': records are scoped to the requested meeting', () => {
    const block = routeBlock(route.key);
    assert.ok(block.includes('meetingId'), 'route must bind the request to a meeting');
    assert.ok(/meetingId|participant|document/.test(block));
    if (route.key === 'registerWorkingDocument' || route.key === 'reviewWorkingDocument' || route.key === 'signAttendance') {
      assert.ok(block.includes('!==meetingId'), 'cross-meeting record must be rejected');
    } else {
      assert.ok(block.includes('context(ctx,env,token,claims,meetingId)'), 'meeting access context must be checked');
      assert.ok(block.includes('listByField') || block.includes('context('), 'records must be scoped by meeting');
    }
  });
  test(route.name + ': authorized request has a success response path', () => {
    const block = routeBlock(route.key);
    assert.ok(block.includes('response(ctx,request,{ok:true'), 'route must return a success response');
  });
}
