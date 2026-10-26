export function buildMonthlyCommunicationsReport({month,websitePublished=[],socialMetrics=[],generatedAt=new Date().toISOString()}={}){
 const safeRows=rows=>(Array.isArray(rows)?rows:[]).map(r=>({title:String(r.title||""),channel:String(r.channel||""),language:String(r.language||""),publishedAt:String(r.publishedAt||""),url:String(r.url||""),reach:Number.isFinite(Number(r.reach))?Number(r.reach):null,source:String(r.source||"reported; verify source")})); 
 return {report:"IRPA Monthly Communications and Funding Report",month:String(month||""),generatedAt,websitePublished:safeRows(websitePublished),socialMetrics:safeRows(socialMetrics),notice:"Reach metrics are not inferred. Values require platform-sourced analytics and should be labelled by source and reporting period."};
}
export function exportReportJson(report){return JSON.stringify(report,null,2);}
