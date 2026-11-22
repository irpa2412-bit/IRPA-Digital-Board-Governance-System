const STAGES=new Set(["READ_ORIGINAL","PDF_BUILD","HASH","ARCHIVE","RECIPIENT_COPIES","CERTIFICATE","PERSIST_COMPLETION_RECORD","SYNC_FIREBASE_MIRROR","DISTRIBUTION"]);
const safeMessage=value=>String(value??"Finalisation step failed.")
  .replace(/Bearer\s+\S+/gi,"Bearer [REDACTED]")
  .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[REDACTED EMAIL]")
  .replace(/https?:\/\/\S+/gi,"[URL REDACTED]")
  .slice(0,180);
const safeCode=value=>String(value??"STAGE_FAILED").replace(/[^A-Z0-9_-]/gi,"").slice(0,48)||"STAGE_FAILED";
async function persistStage(ctx,envelopeId,stageCode,entry){
  for(let attempt=0;attempt<3;attempt++){
    const current=await ctx.meta.get("envelopes",envelopeId);
    if(!current)throw new Error("Envelope disappeared while recording finalisation stage.");
    const record=current.finalisationRecord||{};
    const stages={...(record.stages||{}),[stageCode]:entry};
    const failed=Object.entries(stages).find(([,value])=>value?.status==="FAILED");
    try{
      await ctx.meta.update("envelopes",envelopeId,{
        finalisationRecord:{...record,stages,latestStage:stageCode,updatedAt:entry.recordedAt,...(failed?{firstFailedStage:failed[0]}:{firstFailedStage:null})}
      },{ifVersion:current._v});
      return;
    }catch(error){
      if(attempt===2||!String(error?.name||"").includes("Version"))throw error;
    }
  }
}
export function createFinalisationAttemptRecord(previous={},attemptId,startedAt){
 const history=Array.isArray(previous?.history)?[...previous.history]:[];
 if(previous?.attemptId)history.push({
  attemptId:previous.attemptId,startedAt:previous.startedAt||null,updatedAt:previous.updatedAt||null,
  latestStage:previous.latestStage||null,firstFailedStage:previous.firstFailedStage||null,
  stages:previous.stages||{}
 });
 return {attemptId:String(attemptId),startedAt,updatedAt:startedAt,latestStage:null,firstFailedStage:null,stages:{},history:history.slice(-10)};
}
export async function recordFinalisationStage(ctx,envelopeId,stageCode,step){
 if(!STAGES.has(stageCode))throw new TypeError("Unsupported finalisation stage.");
 const current=await ctx.meta.get("envelopes",envelopeId);
 const attemptId=current?.finalisationRecord?.attemptId||null;
 try{
  const result=await step();
  await persistStage(ctx,envelopeId,stageCode,{status:"PASS",stageCode,attemptId,errorCode:null,errorMessage:null,recordedAt:ctx.now().toISOString()});
  return result;
 }catch(error){
  const entry={status:"FAILED",stageCode,attemptId,errorCode:safeCode(error?.code),errorMessage:safeMessage(error?.message),recordedAt:ctx.now().toISOString()};
  try{await persistStage(ctx,envelopeId,stageCode,entry);}
  catch(recordError){ctx.logger?.error?.("SIGNATURE_FINALISATION_STAGE_RECORD_FAILED",{envelopeId,stageCode,errorType:String(recordError?.name||"Error").slice(0,40)});}
  throw error;
 }
}
