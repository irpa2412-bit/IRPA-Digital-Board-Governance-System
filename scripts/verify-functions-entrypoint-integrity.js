const fs=require("fs");
const source=fs.readFileSync("functions/index.js","utf8");
const required=["trialOnly:true","boardMembersPreserved:true","RESET IRPA TRIAL DATA","exports.resetTrialData"];
for(const token of required){if(!source.includes(token))throw new Error("Missing reset safety marker: "+token);}
if(source.includes('employeeCounters").doc("employees").set({currentNumber:0')||source.includes('memberCounters").doc("members").set({currentNumber:0'))throw new Error("Trial reset must not rewrite production numbering counters.");
console.log("Trial-only reset safety markers present and production counters are preserved.");
