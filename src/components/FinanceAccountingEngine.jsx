import React,{useEffect,useMemo,useState}from"react";
import{createRecord,getRecords,COLLECTIONS}from"../firebase/data";

const DEFAULT_ACCOUNTS=[
 {code:"1100",name:"Cash & Bank",type:"Asset",normal:"Debit"},
 {code:"1200",name:"Receivables",type:"Asset",normal:"Debit"},
 {code:"2100",name:"Payables",type:"Liability",normal:"Credit"},
 {code:"3000",name:"Accumulated Fund / Net Assets",type:"Equity",normal:"Credit"},
 {code:"4100",name:"Grant Income",type:"Income",normal:"Credit"},
 {code:"4200",name:"Donations & Other Income",type:"Income",normal:"Credit"},
 {code:"5100",name:"Personnel Costs",type:"Expense",normal:"Debit"},
 {code:"5200",name:"Programme Activities",type:"Expense",normal:"Debit"},
 {code:"5300",name:"Procurement & Supplies",type:"Expense",normal:"Debit"},
 {code:"5400",name:"Transport & Logistics",type:"Expense",normal:"Debit"},
 {code:"5500",name:"Administration",type:"Expense",normal:"Debit"}
];
const emptyLine={accountCode:"",description:"",debit:"",credit:""};
const money=v=>Number(v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const num=v=>Number(v||0)||0;

export default function FinanceAccountingEngine(){
 const[tab,setTab]=useState("control"),[accounts,setAccounts]=useState([]),[journals,setJournals]=useState([]);
 const[budgets,setBudgets]=useState([]),[commitments,setCommitments]=useState([]),[transactions,setTransactions]=useState([]);
 const[busy,setBusy]=useState(false),[message,setMessage]=useState(""),[error,setError]=useState("");
 const[accountForm,setAccountForm]=useState({code:"",name:"",type:"Expense",normal:"Debit"});
 const[journal,setJournal]=useState({reference:"",date:new Date().toISOString().slice(0,10),description:"",lines:[{...emptyLine}]});
 async function load(){try{const[a,j,b,c,t]=await Promise.all([getRecords(COLLECTIONS.financeChartOfAccounts),getRecords(COLLECTIONS.financeJournalBatches),getRecords(COLLECTIONS.financeBudgets),getRecords(COLLECTIONS.financeCommitments),getRecords(COLLECTIONS.financeTransactions)]);setAccounts(a);setJournals(j);setBudgets(b);setCommitments(c);setTransactions(t)}catch(e){setError(e?.message||"Unable to load financial engine records.")}}
 useEffect(()=>{load()},[]);
 const budgetTotal=useMemo(()=>budgets.reduce((s,r)=>s+num(r.amount??r.budgetAmount),0),[budgets]);
 const commitmentTotal=useMemo(()=>commitments.reduce((s,r)=>s+num(r.amount??r.committedAmount),0),[commitments]);
 const postedTotal=useMemo(()=>transactions.filter(r=>["Posted","Reconciled"].includes(r.status)).reduce((s,r)=>s+num(r.amount),0),[transactions]);
 const available=budgetTotal-commitmentTotal-postedTotal;
 const totals=useMemo(()=>journal.lines.reduce((a,l)=>({debit:a.debit+num(l.debit),credit:a.credit+num(l.credit)}),{debit:0,credit:0}),[journal.lines]);
 const balanced=Math.abs(totals.debit-totals.credit)<0.005;
 const addLine=()=>setJournal(j=>({...j,lines:[...j.lines,{...emptyLine}]}));
 const removeLine=i=>setJournal(j=>({...j,lines:j.lines.length===1?j.lines:j.lines.filter((_,n)=>n!==i)}));
 const updateLine=(i,key,value)=>setJournal(j=>({...j,lines:j.lines.map((l,n)=>n===i?{...l,[key]:value}:l)}));
 async function saveAccount(e){e.preventDefault();setError("");setMessage("");if(!accountForm.code.trim()||!accountForm.name.trim())return setError("Account code and account name are required.");setBusy(true);try{await createRecord(COLLECTIONS.financeChartOfAccounts,{...accountForm,code:accountForm.code.trim(),name:accountForm.name.trim(),financialControl:true,active:true});setMessage("Chart of Accounts item created.");setAccountForm({code:"",name:"",type:"Expense",normal:"Debit"});await load()}catch(e){setError(e?.message||"Unable to create account.")}finally{setBusy(false)}}
 async function saveJournal(e){e.preventDefault();setError("");setMessage("");if(!journal.reference.trim())return setError("Journal reference is required.");if(journal.lines.length<2)return setError("A journal requires at least two lines.");if(journal.lines.filter(l=>l.accountCode.trim()).length<2)return setError("At least two account lines are required.");if(!balanced)return setError("Journal is not balanced. Total debit must equal total credit.");if(totals.debit<=0)return setError("Journal amount must be greater than zero.");setBusy(true);try{await createRecord(COLLECTIONS.financeJournalBatches,{reference:journal.reference.trim(),date:journal.date,description:journal.description.trim(),lines:journal.lines.map(l=>({...l,debit:num(l.debit),credit:num(l.credit)})),totalDebit:totals.debit,totalCredit:totals.credit,status:"Draft",workflowStage:"Draft",postingStatus:"Unposted",financialControl:true,controlNote:"Draft journal only. Posting remains subject to authorised Finance workflow."});setMessage("Balanced journal draft saved. It has not been posted to the ledger.");setJournal({reference:"",date:new Date().toISOString().slice(0,10),description:"",lines:[{...emptyLine}]});await load()}catch(e){setError(e?.message||"Unable to save journal draft.")}finally{setBusy(false)}}
 return <section className="panel finance-accounting-engine" id="finance-accounting-engine">
  <div className="panel-header"><div><span className="eyebrow">FINANCIAL TECHNOLOGY ENGINE</span><h2>Accounting, Formula & Control Workspace</h2><p className="panel-description">A controlled financial technology layer above the existing Finance and Procurement registers. Calculations are derived from registered records; journal drafts cannot be posted from this workspace.</p></div></div>
  {message&&<div className="success-message">{message}</div>}{error&&<div className="error-message">{error}</div>}
  <div className="finance-engine-tabs" role="tablist">{[["control","Control Centre"],["accounts","Chart of Accounts"],["journal","Journal Workspace"]].map(([id,label])=><button key={id} type="button" className={tab===id?"active":""} onClick={()=>setTab(id)}>{label}</button>)}</div>
  {tab==="control"&&<div className="finance-engine-grid">
   <div className="finance-engine-card"><span>Registered Budget</span><strong>{money(budgetTotal)}</strong><small>Finance Budget Register</small></div>
   <div className="finance-engine-card"><span>Commitments</span><strong>{money(commitmentTotal)}</strong><small>Commitment Register</small></div>
   <div className="finance-engine-card"><span>Posted / Reconciled</span><strong>{money(postedTotal)}</strong><small>Transaction Register</small></div>
   <div className="finance-engine-card"><span>Available Control Balance</span><strong>{money(available)}</strong><small>Budget − Commitments − Posted</small></div>
   <div className="finance-formula-card"><h3>Core control formulas</h3><code>Available Budget = Budget − Commitments − Posted Expenditure</code><code>Journal Balance = Total Debit − Total Credit</code><code>Bank Difference = Statement Balance − Book Balance</code><code>Variance = Approved Budget − Actual Expenditure</code></div>
   <div className="finance-formula-card"><h3>Governance gates</h3><ul><li>Existing approval lifecycle remains authoritative.</li><li>Procurement expenditure remains linked to its Finance handoff.</li><li>Journal drafts must balance before storage.</li><li>Posting remains a separate authorised Finance action.</li><li>Existing audit and payment-trace mechanisms remain authoritative.</li></ul></div>
  </div>}
  {tab==="accounts"&&<div className="finance-engine-section">
   <div className="finance-engine-card"><h3>Suggested Chart of Accounts</h3><div className="table-wrapper"><table><thead><tr><th>Code</th><th>Account</th><th>Type</th><th>Normal Balance</th></tr></thead><tbody>{DEFAULT_ACCOUNTS.map(a=><tr key={a.code}><td>{a.code}</td><td>{a.name}</td><td>{a.type}</td><td>{a.normal}</td></tr>)}{accounts.map(a=><tr key={a.id}><td>{a.code}</td><td>{a.name}</td><td>{a.type}</td><td>{a.normal}</td></tr>)}</tbody></table></div></div>
   <form className="finance-engine-card" onSubmit={saveAccount}><h3>Add controlled account</h3><div className="form-grid"><label className="form-field">Code<input value={accountForm.code} onChange={e=>setAccountForm({...accountForm,code:e.target.value})} required/></label><label className="form-field">Name<input value={accountForm.name} onChange={e=>setAccountForm({...accountForm,name:e.target.value})} required/></label><label className="form-field">Type<select value={accountForm.type} onChange={e=>setAccountForm({...accountForm,type:e.target.value})}><option>Asset</option><option>Liability</option><option>Equity</option><option>Income</option><option>Expense</option></select></label><label className="form-field">Normal Balance<select value={accountForm.normal} onChange={e=>setAccountForm({...accountForm,normal:e.target.value})}><option>Debit</option><option>Credit</option></select></label></div><button disabled={busy}>{busy?"Saving…":"Add Account"}</button></form>
  </div>}
  {tab==="journal"&&<div className="finance-engine-section">
   <form className="finance-engine-card" onSubmit={saveJournal}><h3>Balanced Journal Draft</h3><div className="form-grid"><label className="form-field">Journal Reference<input value={journal.reference} onChange={e=>setJournal({...journal,reference:e.target.value})} required/></label><label className="form-field">Date<input type="date" value={journal.date} onChange={e=>setJournal({...journal,date:e.target.value})} required/></label><label className="form-field form-field-wide">Description<input value={journal.description} onChange={e=>setJournal({...journal,description:e.target.value})}/></label></div>
    <div className="table-wrapper"><table><thead><tr><th>Account Code</th><th>Description</th><th>Debit</th><th>Credit</th><th></th></tr></thead><tbody>{journal.lines.map((l,i)=><tr key={i}><td><input value={l.accountCode} onChange={e=>updateLine(i,"accountCode",e.target.value)} placeholder="e.g. 5100"/></td><td><input value={l.description} onChange={e=>updateLine(i,"description",e.target.value)}/></td><td><input type="number" min="0" step="0.01" value={l.debit} onChange={e=>updateLine(i,"debit",e.target.value)}/></td><td><input type="number" min="0" step="0.01" value={l.credit} onChange={e=>updateLine(i,"credit",e.target.value)}/></td><td><button type="button" className="secondary-button" onClick={()=>removeLine(i)}>Remove</button></td></tr>)}</tbody><tfoot><tr><th colSpan="2">Control Totals</th><th>{money(totals.debit)}</th><th>{money(totals.credit)}</th><th>{balanced?"BALANCED":"OUT OF BALANCE"}</th></tr></tfoot></table></div>
    <div className="form-actions"><button type="button" className="secondary-button" onClick={addLine}>Add Journal Line</button><button disabled={busy||!balanced}>{busy?"Saving…":"Save Draft Journal"}</button></div>
   </form>
   <div className="finance-engine-card"><h3>Recent journal drafts</h3><div className="table-wrapper"><table><thead><tr><th>Reference</th><th>Date</th><th>Debit</th><th>Credit</th><th>Status</th></tr></thead><tbody>{journals.length?journals.slice(0,25).map(j=><tr key={j.id}><td>{j.reference||j.id}</td><td>{j.date||"—"}</td><td>{money(j.totalDebit)}</td><td>{money(j.totalCredit)}</td><td><span className="status-badge">{j.status||"Draft"}</span></td></tr>):<tr><td colSpan="5">No journal drafts recorded.</td></tr>}</tbody></table></div></div>
  </div>}
 </section>
}
