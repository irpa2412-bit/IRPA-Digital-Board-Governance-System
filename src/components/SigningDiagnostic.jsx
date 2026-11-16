import React,{useEffect,useState}from"react";
export default function SigningDiagnostic(){
 const[report,setReport]=useState(null);
 useEffect(()=>{const receive=event=>setReport(event?.detail||null);window.addEventListener("irpa:signing-diagnostic",receive);return()=>window.removeEventListener("irpa:signing-diagnostic",receive)},[]);
 if(!report)return null;
 const text=JSON.stringify({title:"Signing diagnostic",...report},null,2);
 const copy=()=>{if(navigator.clipboard?.writeText)navigator.clipboard.writeText(text).catch(()=>{});};
 return <section role="alert" aria-live="assertive" style={{position:"fixed",zIndex:2500,left:12,right:12,bottom:12,maxWidth:760,margin:"0 auto",padding:14,border:"2px solid #b45309",borderRadius:10,background:"var(--surface,#fff)",color:"var(--text,#111)",boxShadow:"0 8px 28px rgba(0,0,0,.28)"}}>
  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:12,flexWrap:"wrap"}}><strong>Signing diagnostic</strong><button type="button" onClick={copy}>Copy Report</button></div>
  <dl style={{display:"grid",gridTemplateColumns:"max-content minmax(0,1fr)",gap:"4px 10px",fontSize:12,margin:"10px 0 0",overflowWrap:"anywhere"}}>
   {Object.entries(report).map(([key,value])=><React.Fragment key={key}><dt style={{fontWeight:700}}>{key}</dt><dd style={{margin:0}}>{String(value)}</dd></React.Fragment>)}
  </dl>
 </section>;
}
