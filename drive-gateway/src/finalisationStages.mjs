const STAGES=new Set(["PDF_BUILD","HASH","ARCHIVE","CERTIFICATE","DISTRIBUTION"]);
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
export async function recordFinalisationStage(ctx,envelopeId,stageCode,step){
  if(!STAGES.has(stageCode))throw new TypeError("Unsupported finalisation stage.");
  try{
    const result=await step();
    await persistStage(ctx,envelopeId,stageCode,{status:"PASS",stageCode,errorCode:null,errorMessage:null,recordedAt:ctx.now().toISOString()});
    return result;
  }catch(error){
    const entry={status:"FAILED",stageCode,errorCode:safeCode(error?.code),errorMessage:safeMessage(error?.message),recordedAt:ctx.now().toISOString()};
    try{await persistStage(ctx,envelopeId,stageCode,entry);}
    catch(recordError){ctx.logger?.error?.("SIGNATURE_FINALISATION_STAGE_RECORD_FAILED",{envelopeId,stageCode,errorType:String(recordError?.name||"Error").slice(0,40)});}
    throw error;
  }
}
