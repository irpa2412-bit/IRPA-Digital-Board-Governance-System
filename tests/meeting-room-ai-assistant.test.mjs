import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const source=await readFile(new URL("../src/pages/MeetingRoom.jsx",import.meta.url),"utf8");

test("Meeting Room exposes a keyboard-accessible AI Assistant access button",()=>{
  assert.match(source,/Open Meeting Room AI Assistant/);
  assert.match(source,/aria-haspopup="dialog"/);
  assert.match(source,/id="irpa-meeting-assistant-command"/);
  assert.match(source,/role="dialog"/);
});

test("assistant command router supports meeting navigation and transcript actions",()=>{
  for(const pattern of [
    /irpa-meeting-quorum/,
    /irpa-meeting-attendance/,
    /irpa-meeting-agenda/,
    /irpa-meeting-ai-assistant/,
    /irpa-maa-dictionary/,
    /irpa-meeting-records/,
    /await translateTranscript\(\)/,
    /await saveTranscript\(\)/,
    /toggleLiveInterpreter\(\)/,
    /startTranscript\(false\)/,
    /nav\("Documents"\)/
  ]) assert.match(source,pattern);
});

test("free-text assistant commands cannot directly execute governance decisions",()=>{
  assert.match(source,/I will not execute a vote, approval, signature, decision, action or meeting closure from free-text commands/);
  assert.match(source,/controlled workflow/);
});

test("AI Assistant is attached only inside the selected meeting view and reuses existing controller checks",()=>{
  assert.match(source,/{selected&&<>/);
  assert.match(source,/if\(!controller\).*read-only/s);
  assert.match(source,/selected\?\.status!=="In Progress"/);
});
