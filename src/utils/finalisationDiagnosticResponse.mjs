export function normalizeFinalisationDiagnostic(value){
 if(!value||typeof value!=="object"||Array.isArray(value)||value.schema!=="IRPA-FINALISATION-DIAGNOSTIC-1"||typeof value.envelopeId!=="string"||!Array.isArray(value.steps))return null;
 const steps=value.steps.filter(step=>step&&typeof step==="object"&&!Array.isArray(step)&&typeof step.stageCode==="string"&&["PASS","FAILED"].includes(step.status)).map(step=>({...step,fields:Array.isArray(step.fields)?step.fields.filter(field=>field&&typeof field==="object"&&!Array.isArray(field)):[]}));
 if(steps.length!==value.steps.length)return null;
 return {...value,steps,fieldChecks:Array.isArray(value.fieldChecks)?value.fieldChecks.filter(field=>field&&typeof field==="object"&&!Array.isArray(field)):[],summary:value.summary&&typeof value.summary==="object"&&!Array.isArray(value.summary)?value.summary:{passed:steps.filter(x=>x.status==="PASS").length,failed:steps.filter(x=>x.status==="FAILED").length,firstFailedStage:steps.find(x=>x.status==="FAILED")?.stageCode||null}};
}
