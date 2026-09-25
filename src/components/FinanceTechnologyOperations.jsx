import React,{useState}from"react";
import{callFinanceAccounting}from"../firebase/data";
import*as XLSX from"xlsx";

const money=v=>Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const download=(name,blob)=>{const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);};

export default function FinanceTechnologyOperations(){
 const[period,setPeriod]=useState(new Date().toISOString().slice(0,7)),[journalId,setJournalId]=useState(""),[bank,setBank]=useState({account:"",statement:"",book:""}),[asset,setAsset]=useState({name:"",cost:"",category:"",usefulLifeMonths:"60",location:""}),[payroll,setPayroll]=useState({gross:"",deductions:"",employerContributions:""}),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
 async function run(name,data={}){
  setBusy(true);setError("");setResult(null);
  try{setResult({operation:name,data:await callFinanceAccounting(name,data)})}catch(e){setError(e?.message||"Operation failed.")}finally{setBusy(false)}
 }
 async function exportXlsx(source){
  setBusy(true);setError("");
  try{const r=await callFinanceAccounting("exportFinanceCsv",{source});const rows=String(r.csv||"").split("\n").filter(Boolean);const parsed=rows.map(line=>{const out=[];let cur="",q=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(q&&line[i+1]==='"'){cur+='"';i++;}else q=!q;}else if(ch===","&&!q){out.push(cur);cur="";}else cur+=ch;}out.push(cur);return out});const ws=XLSX.utils.aoa_to_sheet(parsed);const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,"Finance");XLSX.writeFile(wb,r.filename.replace(/\.csv$/,".xlsx"));setResult({operation:"Excel Export",data:{source,rowCount:r.rowCount,filename:r.filename.replace(/\.csv$/,".xlsx")}})}catch(e){setError(e?.message||"Excel export failed.")}finally{setBusy(false)}
 }
 async function importXlsx(e){
  const file=e.target.files?.[0];if(!file)return;setBusy(true);setError("");
  try{const wb=XLSX.read(await file.arrayBuffer(),{type:"array"});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:""});if(!rows.length)throw new Error("The workbook contains no data rows.");const source=window.prompt("Import into which register? Enter financeBudgets, financeCommitments, or financeTransactions.","financeTransactions");if(!source)return;const r=await callFinanceAccounting("importFinanceCsvRows",{source,rows});setResult({operation:"Excel Import",data:r})}catch(e){setError(e?.message||"Excel import failed.")}finally{setBusy(false);e.target.value=""}
 }
 return <section className="panel finance-technology-operations">
  <div className="panel-header"><div><span className="eyebrow">FINANCE TECHNOLOGY & GOVERNANCE</span><h2>Accounting Operations & Financial Controls</h2><p className="panel-description">Authoritative server-side controls for posting, periods, reconciliation, reporting, procurement matching, donor restrictions, assets, payroll calculations and Excel interoperability.</p></div></div>
  {error&&<div className="error-message">{error}</div>}{busy&&<div className="success-message">Processing controlled Finance operation…</div>}
  <div className="finance-engine-tabs">
   <button type="button" onClick={()=>run("initializeFinanceStructure")}>Initialize Finance Structure</button>
   <button type="button" onClick={()=>run("getFinanceTrialBalance",{period})}>Trial Balance</button>
   <button type="button" onClick={()=>run("getFinanceStatements",{period})}>Financial Statements</button>
   <button type="button" onClick={()=>run("calculateFinanceBudgetVariance",{period})}>Budget vs Actual</button>
   <button type="button" onClick={()=>run("closeFinancePeriod",{period})}>Close Period</button>
  </div>
  <div className="finance-engine-section">
   <div className="finance-engine-card"><h3>Period & Journal Controls</h3><div className="form-grid"><label className="form-field">Financial Period<input type="month" value={period} onChange={e=>setPeriod(e.target.value)}/></label><label className="form-field">Journal ID<input value={journalId} onChange={e=>setJournalId(e.target.value)} placeholder="Paste journal document ID"/></label></div><div className="form-actions"><button disabled={!journalId||busy} onClick={()=>run("submitFinanceJournalForApproval",{journalId})}>Submit Journal</button><button disabled={!journalId||busy} onClick={()=>run("postFinanceJournal",{journalId})}>Post Journal</button><button disabled={!journalId||busy} onClick={()=>run("reverseFinanceJournal",{journalId,reason:"Authorised accounting correction"})}>Request Reversal</button></div></div>
   <div className="finance-engine-card"><h3>Bank Reconciliation</h3><div className="form-grid"><label className="form-field">Bank Account<input value={bank.account} onChange={e=>setBank({...bank,account:e.target.value})}/></label><label className="form-field">Statement Balance<input type="number" step="0.01" value={bank.statement} onChange={e=>setBank({...bank,statement:e.target.value})}/></label><label className="form-field">Book Balance<input type="number" step="0.01" value={bank.book} onChange={e=>setBank({...bank,book:e.target.value})}/></label></div><button disabled={busy||!bank.account} onClick={()=>run("reconcileFinanceBank",{period,bankAccount:bank.account,statementBalance:bank.statement,bookBalance:bank.book,outstandingItems:[]})}>Reconcile Bank</button></div>
   <div className="finance-engine-card"><h3>Asset Register</h3><div className="form-grid"><label className="form-field">Asset Name<input value={asset.name} onChange={e=>setAsset({...asset,name:e.target.value})}/></label><label className="form-field">Cost<input type="number" step="0.01" value={asset.cost} onChange={e=>setAsset({...asset,cost:e.target.value})}/></label><label className="form-field">Category<input value={asset.category} onChange={e=>setAsset({...asset,category:e.target.value})}/></label><label className="form-field">Useful Life (months)<input type="number" value={asset.usefulLifeMonths} onChange={e=>setAsset({...asset,usefulLifeMonths:e.target.value})}/></label><label className="form-field">Location<input value={asset.location} onChange={e=>setAsset({...asset,location:e.target.value})}/></label></div><button disabled={busy||!asset.name||!asset.cost} onClick={()=>run("registerFinanceAsset",asset)}>Register Asset</button></div>
   <div className="finance-engine-card"><h3>Payroll Formula Control</h3><div className="form-grid"><label className="form-field">Gross Pay<input type="number" step="0.01" value={payroll.gross} onChange={e=>setPayroll({...payroll,gross:e.target.value})}/></label><label className="form-field">Employee Deductions<input type="number" step="0.01" value={payroll.deductions} onChange={e=>setPayroll({...payroll,deductions:e.target.value})}/></label><label className="form-field">Employer Contributions<input type="number" step="0.01" value={payroll.employerContributions} onChange={e=>setPayroll({...payroll,employerContributions:e.target.value})}/></label></div><button disabled={busy} onClick={()=>run("calculateFinancePayroll",payroll)}>Calculate Payroll</button></div>
   <div className="finance-engine-card"><h3>Excel Interoperability</h3><p>Exports are generated from registered Finance records. Imports are restricted to approved registers and are marked as CSV_IMPORT for audit traceability.</p><div className="form-actions"><button onClick={()=>exportXlsx("financeLedgerEntries")} disabled={busy}>Export Ledger to Excel</button><button onClick={()=>exportXlsx("financeTransactions")} disabled={busy}>Export Transactions to Excel</button><label className="secondary-button">Import Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={importXlsx} hidden/></label></div></div>
  </div>
  {result&&<div className="finance-engine-card"><h3>Operation Result</h3><pre className="finance-operation-result">{JSON.stringify(result,null,2)}</pre></div>}
 </section>
}
