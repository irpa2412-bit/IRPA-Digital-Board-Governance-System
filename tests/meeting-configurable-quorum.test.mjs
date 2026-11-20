import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {normalizeMeetingGovernancePolicy,calculateRequiredQuorum,calculateVotingOutcome} from "../src/utils/meetingGovernancePolicy.mjs";
const source={reference:"IRPA policy as stated by the owner, 20 Nov 2026",effectiveDate:"2026-11-20"};
const policy=(quorum,voting={thresholdType:"simple_majority",denominatorBasis:"votes_cast"})=>normalizeMeetingGovernancePolicy({quorum,voting,source});
test("fixed quorum count and percentage quorum use configured eligible-member denominator",()=>{
 assert.deepEqual(calculateRequiredQuorum(10,{basis:"fixed",fixedCount:4}).required,4);
 assert.deepEqual(calculateRequiredQuorum(10,{basis:"percentage",numerator:1,denominator:3}).required,4);
 assert.equal(calculateRequiredQuorum(10,{basis:"percentage",numerator:2,denominator:3}).required,7);
});
test("quorum cannot be assessed without an explicit rule",()=>{
 assert.equal(calculateRequiredQuorum(10,{}).status,"NOT_CONFIGURED");
 assert.equal(policy({basis:"percentage",numerator:1,denominator:3},{thresholdType:"",denominatorBasis:"votes_cast"}).status,"UNCONFIGURED");
});
test("simple majority is strictly more than half and one-third and two-thirds are configurable",()=>{
 const simple=policy({basis:"fixed",fixedCount:1});
 assert.equal(calculateVotingOutcome({forCount:2,againstCount:2,eligibleCount:4,presentCount:4,quorumMet:true,policy:simple}).result,"Pending");
 assert.equal(calculateVotingOutcome({forCount:3,againstCount:2,eligibleCount:5,presentCount:5,quorumMet:true,policy:simple.voting}).result,"Passed");
 const oneThird=policy({basis:"fixed",fixedCount:1},{thresholdType:"one_third",denominatorBasis:"votes_cast"});
 assert.equal(calculateVotingOutcome({forCount:2,againstCount:4,quorumMet:true,policy:oneThird}).result,"Passed");
 const twoThirds=policy({basis:"fixed",fixedCount:1},{thresholdType:"two_thirds",denominatorBasis:"votes_cast"});
 assert.equal(calculateVotingOutcome({forCount:4,againstCount:2,quorumMet:true,policy:twoThirds}).result,"Passed");
 assert.equal(calculateVotingOutcome({forCount:3,againstCount:3,quorumMet:true,policy:twoThirds.voting}).result,"Rejected");
});
test("custom ratio, abstentions, ties and quorum gates follow the saved policy",()=>{
 const custom=policy({basis:"fixed",fixedCount:1},{thresholdType:"custom",numerator:3,denominator:4,denominatorBasis:"votes_cast",abstentionTreatment:"exclude",tiePolicy:"rejected"});
 assert.equal(calculateVotingOutcome({forCount:3,againstCount:1,abstainCount:2,quorumMet:true,policy:custom}).result,"Passed");
 assert.equal(calculateVotingOutcome({forCount:1,againstCount:1,quorumMet:true,policy:custom.voting}).result,"Rejected");
 assert.equal(calculateVotingOutcome({forCount:3,againstCount:1,quorumMet:false,policy:custom.voting}).result,"INVALID_QUORUM");
 const noAbstain=policy({basis:"fixed",fixedCount:1},{thresholdType:"simple_majority",denominatorBasis:"votes_cast",abstentionTreatment:"count_as_against"});
 assert.equal(calculateVotingOutcome({forCount:2,againstCount:1,abstainCount:2,quorumMet:true,policy:noAbstain}).denominator,5);
});
test("Cloudflare derives quorum and vote result from the configured policy, not a client-supplied result",()=>{
 const service=fs.readFileSync("drive-gateway/src/meetingServices.mjs","utf8");
const data=fs.readFileSync("src/firebase/data.js","utf8");
 assert.match(service,/calculateRequiredQuorum/);assert.match(service,/calculateVotingOutcome/);
 assert.match(service,/governancePolicySnapshot/);assert.match(service,/tally:outcome/);
 assert.doesNotMatch(service,/Math\.ceil\(denominator\/3\)/);
 assert.match(service,/Voting is blocked until an authorised quorum and voting policy is configured/);
 assert.ok(data.includes('callMeetingService("/api/meeting-voting/open"'));
 assert.ok(data.includes('callMeetingService("/api/meeting-voting/close"'));
});

test("IRPA owner quorum default is one-third rounded up, including zero and boundary cases",()=>{
 const rule={basis:"percentage",numerator:1,denominator:3};
 assert.equal(calculateRequiredQuorum(0,rule).status,"NOT_ASSESSABLE");
 assert.equal(calculateRequiredQuorum(7,rule).required,3);
 assert.equal(calculateRequiredQuorum(9,rule).required,3);
 assert.equal(calculateRequiredQuorum(10,rule).required,4);
 const required=calculateRequiredQuorum(10,rule).required;
 assert.equal(3>=required,false,"one below quorum must fail");
 assert.equal(4>=required,true,"exact quorum must pass");
 assert.equal(5>=required,true,"one above quorum must pass");
});
test("quorum remains configurable when the IRPA policy changes",()=>{
 assert.equal(calculateRequiredQuorum(10,{basis:"percentage",numerator:2,denominator:3}).required,7);
 assert.equal(calculateRequiredQuorum(9,{basis:"percentage",numerator:2,denominator:3}).required,6);
});
test("eligible voter denominator excludes inactive and non-Board invitees",()=>{
 const service=fs.readFileSync("drive-gateway/src/meetingServices.mjs","utf8");
 assert.match(service,/activeStatus&&isBoard/);
 assert.match(service,/external\\|guest\\|observer\\|non\\.\\?voting\\|committee\\|secretary/);
 assert.match(service,/recusalTreatment:"exclude_from_denominator"/);
});
