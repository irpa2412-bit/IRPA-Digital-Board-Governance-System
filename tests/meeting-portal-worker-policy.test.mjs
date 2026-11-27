imp

test("Meeting Portal Worker access is based on member/employee identity existence, not status", () => {
  const source = readFileSync(new URL("../drive-gateway/src/meetingServices.mjs", import.meta.url), "utf8");
  assert.match(source, /if\(!member&&!employee\)return fail/);
  assert.match(source, /const institutionalIdentity=!!member\|\|!!employee/);
  assert.match(source, /meetingContextAccessAllowed\(meeting,institutionalIdentity,explicitParticipant\)/);
});

test("Meeting Portal frontend grants initiation and category visibility to any registered IRPA identity", () => {
  const policy = readFileSync(new URL("../src/firebase/meetingPolicy.js", import.meta.url), "utf8");
  const page = readFileSync(new URL("../src/pages/Meetings.jsx", import.meta.url), "utf8");
  assert.match(policy, /identity\.memberIdentity===true\|\|identity\.employeeIdentity===true/);
  assert.match(page, /memberIdentity:!!member,employeeIdentity:!!employee/);
  assert.match(page, /identity\.memberIdentity===true\|\|identity\.employeeIdentity===true/);
});
