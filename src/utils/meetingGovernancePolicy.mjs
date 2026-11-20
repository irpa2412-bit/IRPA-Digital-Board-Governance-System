const integer=value=>Number.isInteger(Number(value))?Number(value):NaN;
export function normalizeMeetingGovernancePolicy(input={}){
 const quorum=input.quorum||input.quorumPolicy||{},voting=input.voting||input.votingPolicy||{};
 const basis=String(quorum.basis||"").toLowerCase(),numerator=integer(quorum.numerator),denominator=integer(quorum.denominator),fixedCount=integer(quorum.fixedCount);
 const configured=basis==="fixed"?Number.isInteger(fixedCount)&&fixedCount>0:basis==="percentage"&&Number.isInteger(numerator)&&numerator>0&&Number.isInteger(denominator)&&denominator>0&&numerator<=denominator;
 const thresholdType=String(voting.thresholdType||"").toLowerCase(),thresholdNumerator=integer(voting.numerator),thresholdDenominator=integer(voting.denominator);
 const thresholdConfigured=["simple_majority","one_third","two_thirds"].includes(thresholdType)||(thresholdType==="custom"&&Number.isInteger(thresholdNumerator)&&thresholdNumerator>0&&Number.isInteger(thresholdDenominator)&&thresholdDenominator>0&&thresholdNumerator<=thresholdDenominator);
 const votingDenominator=String(voting.denominatorBasis||"").toLowerCase();
 const sourceReference=String(input.source?.reference||input.policyReference||"").trim(),effectiveDate=String(input.source?.effectiveDate||input.effectiveDate||"").trim();
 return {
  version:1,
  status:configured&&thresholdConfigured&&["votes_cast","eligible_present","total_eligible"].includes(votingDenominator)&&Boolean(sourceReference)&&Boolean(effectiveDate)?"CONFIGURED":"UNCONFIGURED",
  quorum:{basis,fixedCount:Number.isFinite(fixedCount)?fixedCount:null,numerator:Number.isFinite(numerator)?numerator:null,denominator:Number.isFinite(denominator)?denominator:null,denominatorSource:"active_eligible_members"},
  voting:{thresholdType,numerator:Number.isFinite(thresholdNumerator)?thresholdNumerator:null,denominator:Number.isFinite(thresholdDenominator)?thresholdDenominator:null,denominatorBasis:votingDenominator,abstentionTreatment:voting.abstentionTreatment==="count_as_against"?"count_as_against":"exclude",tiePolicy:["rejected","pending","chair_decides"].includes(voting.tiePolicy)?voting.tiePolicy:"pending",requireQuorumAtVoteOpen:voting.requireQuorumAtVoteOpen!==false,requireQuorumAtVoteClose:voting.requireQuorumAtVoteClose!==false,eligibleVoterGroup:String(voting.eligibleVoterGroup||"board_members"),secondingRequired:voting.secondingRequired===true,recusalTreatment:"exclude_from_denominator",proxyPolicy:"not_permitted",vacantSeatTreatment:"exclude_inactive_and_vacant_seats"},
  source:{reference:sourceReference,effectiveDate}
 };
}
export function calculateRequiredQuorum(eligibleCount,policyInput={}){
 const count=Math.max(0,integer(eligibleCount)||0),basis=String(policyInput.basis||"").toLowerCase();
 const fixedCount=integer(policyInput.fixedCount),numerator=integer(policyInput.numerator),denominator=integer(policyInput.denominator);
 const configured=basis==="fixed"?Number.isInteger(fixedCount)&&fixedCount>0:basis==="percentage"&&Number.isInteger(numerator)&&numerator>0&&Number.isInteger(denominator)&&denominator>0&&numerator<=denominator;
 if(!configured||count===0)return {configured:false,required:null,eligibleCount:count,status:"NOT_CONFIGURED"};
 const required=basis==="fixed"?fixedCount:Math.ceil(count*numerator/denominator);
 return {configured:true,required:Math.min(count,required),eligibleCount:count,status:"CONFIGURED",rule:basis==="fixed"?`Fixed count: ${required}`:`Ceiling(${count} × ${numerator}/${denominator}) = ${required}`};
}
export function calculateVotingOutcome({forCount=0,againstCount=0,abstainCount=0,eligibleCount=0,presentCount=0,quorumMet=false,policy:policyInput={}}={}){
 const policy=normalizeMeetingGovernancePolicy({quorum:{basis:"fixed",fixedCount:1},voting:policyInput.voting||policyInput});
 if(policy.status!=="CONFIGURED")return {result:"NOT_CONFIGURED",denominator:0,requiredFor:null,policyVersion:policy.version};
 const v=policy.voting,forVotes=Math.max(0,integer(forCount)||0),against=Math.max(0,integer(againstCount)||0),abstain=Math.max(0,integer(abstainCount)||0);
 const denominator=v.denominatorBasis==="total_eligible"?Math.max(0,integer(eligibleCount)||0):v.denominatorBasis==="eligible_present"?Math.max(0,integer(presentCount)||0):(forVotes+against+(v.abstentionTreatment==="count_as_against"?abstain:0));
 let numerator,denom;
 if(v.thresholdType==="simple_majority"){numerator=1;denom=2;}
 else if(v.thresholdType==="one_third"){numerator=1;denom=3;}
 else if(v.thresholdType==="two_thirds"){numerator=2;denom=3;}
 else {numerator=v.numerator;denom=v.denominator;}
 const requiredFor=v.thresholdType==="simple_majority"?Math.floor(denominator/2)+1:Math.ceil(denominator*numerator/denom);
 if(v.requireQuorumAtVoteClose&&quorumMet!==true)return {result:"INVALID_QUORUM",denominator,requiredFor,forCount:forVotes,againstCount:against,abstainCount:abstain,policyVersion:policy.version};
 if(denominator===0)return {result:"NO_VALID_DENOMINATOR",denominator,requiredFor,forCount:forVotes,againstCount:against,abstainCount:abstain,policyVersion:policy.version};
 if(forVotes+against+abstain===0)return {result:"NO_BALLOTS",denominator,requiredFor,forCount:forVotes,againstCount:against,abstainCount:abstain,policyVersion:policy.version};
 const tied=forVotes===against;
 const result=tied?(v.tiePolicy==="rejected"?"Rejected":v.tiePolicy==="chair_decides"?"CHAIR_DECISION_REQUIRED":"Pending"):(forVotes>=requiredFor?"Passed":"Rejected");
 return {result,denominator,requiredFor,forCount:forVotes,againstCount:against,abstainCount:abstain,policyVersion:policy.version};
}
