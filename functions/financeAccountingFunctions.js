const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getAuth } = require("firebase-admin/auth");

const db = getFirestore();
const auth = getAuth();

const FINANCE_ROLES = new Set([
  "Administrator","Executive Director","Director Finance & Administration",
  "Finance Manager","Accountant","Finance Officer"
]);

async function actor(request){
  const uid=request.auth?.uid;
  if(!uid) throw new HttpsError("unauthenticated","Authentication is required.");
  const tokenEmail=String(request.auth?.token?.email||"").trim().toLowerCase();
  const adminSnap=await db.collection("adminProfiles").doc(uid).get();
  const admin=adminSnap.exists?adminSnap.data():null;
  const employeeSnap=await db.collection("employees").doc(uid).get();
  const memberSnap=await db.collection("members").doc(uid).get();
  const profile=employeeSnap.exists?employeeSnap.data():(memberSnap.exists?memberSnap.data():{});
  const roles=[admin?.role,profile?.role,...(Array.isArray(profile?.roles)?profile.roles:[])].filter(Boolean).map(String);
  const isPrimary=tokenEmail==="irpa2412@gmail.com";
  if(!isPrimary&&!admin?.active&&!roles.some(r=>FINANCE_ROLES.has(r))){
    throw new HttpsError("permission-denied","Finance authorization is required.");
  }
  return {uid,email:tokenEmail,roles,isAdmin:isPrimary||admin?.active===true};
}

function money(v){const n=Number(v);return Number.isFinite(n)?Math.round(n*100)/100:0;}
function clean(v){return String(v??"").trim();}
function csvEscape(v){const s=String(v??"");return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}
function periodKey(v){const s=clean(v);if(/^\d{4}-\d{2}$/.test(s))return s;throw new HttpsError("invalid-argument","Financial period must use YYYY-MM.");}

async function getOpenPeriod(period){
  const snap=await db.collection("financePeriods").doc(period).get();
  if(!snap.exists) return {id:period,status:"Open",implicit:true};
  const data=snap.data()||{};
  if(data.status!=="Open") throw new HttpsError("failed-precondition",`Financial period ${period} is ${data.status}.`);
  return {id:period,...data};
}

async function ensureAccounts(lines){
  const codes=[...new Set(lines.map(x=>clean(x.accountCode)).filter(Boolean))];
  if(codes.length<2) throw new HttpsError("invalid-argument","At least two account codes are required.");
  const snaps=await Promise.all(codes.map(c=>db.collection("financeChartOfAccounts").where("code","==",c).limit(1).get()));
  const missing=codes.filter((c,i)=>snaps[i].empty);
  if(missing.length) throw new HttpsError("failed-precondition",`Unknown account code(s): ${missing.join(", ")}.`);
}

async function createAudit(a,action,details){
  const ref=await db.collection("audit").add({action,category:"FINANCE_ACCOUNTING",performedByUid:a.uid,performedByEmail:a.email,details,createdAt:FieldValue.serverTimestamp()});
  return ref.id;
}

exports.initializeFinanceStructure=onCall({region:"us-central1"},async request=>{
  const a=await actor(request);
  const accounts=[
    ["1100","Cash & Bank","Asset","Debit"],["1200","Receivables","Asset","Debit"],["1300","Prepayments","Asset","Debit"],
    ["2100","Payables","Liability","Credit"],["2200","Accrued Liabilities","Liability","Credit"],
    ["3000","Accumulated Fund / Net Assets","Equity","Credit"],["4100","Grant Income","Income","Credit"],
    ["4200","Donations & Other Income","Income","Credit"],["5100","Personnel Costs","Expense","Debit"],
    ["5200","Programme Activities","Expense","Debit"],["5300","Procurement & Supplies","Expense","Debit"],
    ["5400","Transport & Logistics","Expense","Debit"],["5500","Administration","Expense","Debit"]
  ];
  const batch=db.batch();let created=0;
  for(const [code,name,type,normal] of accounts){
    const ref=db.collection("financeChartOfAccounts").doc(code);
    const snap=await ref.get();
    if(!snap.exists){batch.set(ref,{code,name,type,normal,active:true,systemSeed:true,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});created++;}
  }
  const current=periodKey(new Date().toISOString().slice(0,7));
  const pref=db.collection("financePeriods").doc(current);const ps=await pref.get();
  if(!ps.exists)batch.set(pref,{period:current,status:"Open",openedByUid:a.uid,openedAt:FieldValue.serverTimestamp(),systemSeed:true});
  await batch.commit();
  const auditId=await createAudit(a,"FINANCE_STRUCTURE_INITIALIZED",{createdAccounts:created,period:current});
  return {success:true,createdAccounts:created,period:current,auditId};
});

exports.submitFinanceJournalForApproval=onCall({region:"us-central1"},async request=>{
  const a=await actor(request);const id=clean(request.data?.journalId);if(!id)throw new HttpsError("invalid-argument","Journal ID is required.");
  const ref=db.collection("financeJournalBatches").doc(id);const snap=await ref.get();if(!snap.exists)throw new HttpsError("not-found","Journal draft not found.");
  const d=snap.data()||{};if(d.status!=="Draft")throw new HttpsError("failed-precondition","Only Draft journals can be submitted.");
  const lines=Array.isArray(d.lines)?d.lines:[];const debit=money(lines.reduce((s,l)=>s+money(l.debit),0));const credit=money(lines.reduce((s,l)=>s+money(l.credit),0));
  if(debit<=0||debit!==credit)throw new HttpsError("failed-precondition","Journal must be revalidated as balanced before approval.");
  await ensureAccounts(lines);const period=periodKey(d.date?.slice(0,7)||new Date().toISOString().slice(0,7));await getOpenPeriod(period);
  await ref.update({status:"Submitted for Approval",workflowStage:"Submitted for Approval",postingStatus:"Unposted",validatedDebit:debit,validatedCredit:credit,submittedByUid:a.uid,submittedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  const auditId=await createAudit(a,"FINANCE_JOURNAL_SUBMITTED",{journalId:id,period,debit,credit});return{success:true,journalId:id,period,auditId};
});

exports.postFinanceJournal=onCall({region:"us-central1"},async request=>{
  const a=await actor(request);if(!a.isAdmin&&!a.roles.some(r=>["Director Finance & Administration","Finance Manager","Accountant"].includes(r)))throw new HttpsError("permission-denied","Authorised Finance posting authority is required.");
  const id=clean(request.data?.journalId);if(!id)throw new HttpsError("invalid-argument","Journal ID is required.");
  const ref=db.collection("financeJournalBatches").doc(id);
  const result=await db.runTransaction(async tx=>{
    const snap=await tx.get(ref);if(!snap.exists)throw new HttpsError("not-found","Journal not found.");const d=snap.data()||{};
    if(d.status!=="Submitted for Approval")throw new HttpsError("failed-precondition","Only submitted journals can be posted.");
    const lines=Array.isArray(d.lines)?d.lines:[];const debit=money(lines.reduce((s,l)=>s+money(l.debit),0));const credit=money(lines.reduce((s,l)=>s+money(l.credit),0));
    if(debit<=0||debit!==credit)throw new HttpsError("failed-precondition","Journal is not balanced.");
    const period=periodKey(d.date?.slice(0,7)||new Date().toISOString().slice(0,7));const pRef=db.collection("financePeriods").doc(period);const pSnap=await tx.get(pRef);if(pSnap.exists&&pSnap.data()?.status!=="Open")throw new HttpsError("failed-precondition",`Financial period ${period} is closed.`);
    const journalRef=db.collection("financeLedgerJournals").doc(id);const existing=await tx.get(journalRef);if(existing.exists)throw new HttpsError("already-exists","This journal has already been posted.");
    tx.set(journalRef,{journalId:id,reference:d.reference||id,date:d.date,period,description:d.description||"",totalDebit:debit,totalCredit:credit,status:"Posted",postedByUid:a.uid,postedByEmail:a.email,postedAt:FieldValue.serverTimestamp(),createdAt:FieldValue.serverTimestamp()});
    for(let i=0;i<lines.length;i++){const l=lines[i];tx.set(db.collection("financeLedgerEntries").doc(),{journalId:id,reference:d.reference||id,lineNumber:i+1,accountCode:clean(l.accountCode),description:clean(l.description),debit:money(l.debit),credit:money(l.credit),period,postedByUid:a.uid,postedAt:FieldValue.serverTimestamp(),createdAt:FieldValue.serverTimestamp()});}
    tx.update(ref,{status:"Posted",workflowStage:"Posted",postingStatus:"Posted",postedByUid:a.uid,postedByEmail:a.email,postedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),validatedDebit:debit,validatedCredit:credit});
    return{period,debit,credit};
  });
  const auditId=await createAudit(a,"FINANCE_JOURNAL_POSTED",{journalId:id,...result});return{success:true,journalId:id,...result,auditId};
});

exports.reverseFinanceJournal=onCall({region:"us-central1"},async request=>{
  const a=await actor(request);const id=clean(request.data?.journalId);const reason=clean(request.data?.reason);if(!id||!reason)throw new HttpsError("invalid-argument","Journal ID and reversal reason are required.");
  const snap=await db.collection("financeLedgerJournals").doc(id).get();if(!snap.exists)throw new HttpsError("not-found","Posted ledger journal not found.");
  const j=snap.data()||{};const entries=await db.collection("financeLedgerEntries").where("journalId","==",id).get();if(entries.empty)throw new HttpsError("failed-precondition","No ledger entries exist for the posted journal.");
  const batch=db.batch();const reversalId=`${id}-REV-${Date.now()}`;const rref=db.collection("financeJournalBatches").doc(reversalId);
  const lines=entries.docs.map(d=>{const x=d.data()||{};return{accountCode:x.accountCode,description:`Reversal of ${id}: ${reason}`,debit:money(x.credit),credit:money(x.debit)}});
  batch.set(rref,{reference:reversalId,date:new Date().toISOString().slice(0,10),description:`Reversal of ${id}: ${reason}`,lines,totalDebit:money(j.totalCredit),totalCredit:money(j.totalDebit),status:"Submitted for Approval",workflowStage:"Submitted for Approval",postingStatus:"Unposted",reversalOfJournalId:id,reversalReason:reason,financialControl:true,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  batch.update(db.collection("financeLedgerJournals").doc(id),{reversalRequested:true,reversalRequestedByUid:a.uid,reversalReason:reason,updatedAt:FieldValue.serverTimestamp()});await batch.commit();
  const auditId=await createAudit(a,"FINANCE_JOURNAL_REVERSAL_REQUESTED",{journalId:id,reversalJournalId:reversalId,reason});return{success:true,reversalJournalId:reversalId,auditId};
});

exports.closeFinancePeriod=onCall({region:"us-central1"},async request=>{
  const a=await actor(request);if(!a.isAdmin&&!a.roles.some(r=>["Director Finance & Administration","Finance Manager"].includes(r)))throw new HttpsError("permission-denied","Authorised Finance period-closing authority is required.");
  const period=periodKey(request.data?.period);const pref=db.collection("financePeriods").doc(period);const ps=await pref.get();if(ps.exists&&ps.data()?.status==="Closed")return{success:true,alreadyClosed:true,period};
  const drafts=await db.collection("financeJournalBatches").where("status","in",["Draft","Submitted for Approval"]).get();
  const openInPeriod=drafts.docs.filter(d=>String(d.data()?.date||"").startsWith(period));
  if(openInPeriod.length)throw new HttpsError("failed-precondition",`Cannot close ${period}: ${openInPeriod.length} unposted journal(s) remain.`);
  const exceptions=await db.collection("financeReconciliations").where("status","==","Exception").get();const periodExceptions=exceptions.docs.filter(d=>String(d.data()?.period||"")===period);
  if(periodExceptions.length)throw new HttpsError("failed-precondition",`Cannot close ${period}: unresolved bank reconciliation exception(s) remain.`);
  await pref.set({period,status:"Closed",closedByUid:a.uid,closedByEmail:a.email,closedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
  const auditId=await createAudit(a,"FINANCE_PERIOD_CLOSED",{period});return{success:true,period,auditId};
});

exports.reconcileFinanceBank=onCall({region:"us-central1"},async request=>{
  const a=await actor(request);const period=periodKey(request.data?.period);const account=clean(request.data?.bankAccount);const statementBalance=money(request.data?.statementBalance);const bookBalance=money(request.data?.bookBalance);const outstanding=Array.isArray(request.data?.outstandingItems)?request.data.outstandingItems:[];
  if(!account)throw new HttpsError("invalid-argument","Bank account is required.");
  const difference=money(statementBalance-bookBalance);const status=Math.abs(difference)<0.01?"Reconciled":"Exception";
  const ref=db.collection("financeReconciliations").doc(`${period}-${account}`);
  await ref.set({period,bankAccount:account,statementBalance,bookBalance,reconciliationDifference:difference,outstandingItems:outstanding,status,reviewedByUid:a.uid,reviewedByEmail:a.email,reviewedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),financialControl:true},{merge:true});
  const auditId=await createAudit(a,"FINANCE_BANK_RECONCILIATION",{period,bankAccount:account,difference,status});return{success:true,period,bankAccount:account,difference,status,auditId};
});

exports.calculateFinanceBudgetVariance=onCall({region:"us-central1"},async request=>{
  await actor(request);const period=clean(request.data?.period);const budgets=(await db.collection("financeBudgets").get()).docs.map(d=>d.data()||{});const commitments=(await db.collection("financeCommitments").get()).docs.map(d=>d.data()||{});const transactions=(await db.collection("financeTransactions").get()).docs.map(d=>d.data()||{});
  const scope=x=>!period||String(x.budgetYear||x.date||x.reportingPeriod||"").includes(period);
  const budget=money(budgets.filter(scope).reduce((s,x)=>s+money(x.amount??x.budgetAmount),0));const committed=money(commitments.filter(scope).reduce((s,x)=>s+money(x.amount??x.committedAmount),0));const actual=money(transactions.filter(x=>["Posted","Reconciled"].includes(x.status)&&scope(x)).reduce((s,x)=>s+money(x.amount),0));
  return{period:period||"ALL",approvedBudget:budget,commitments:committed,actualExpenditure:actual,availableBudget:money(budget-committed-actual),variance:money(budget-actual),formula:"Approved Budget − Actual Expenditure"};
});

exports.getFinanceTrialBalance=onCall({region:"us-central1"},async request=>{
  await actor(request);const period=clean(request.data?.period);const entries=(await db.collection("financeLedgerEntries").get()).docs.map(d=>d.data()||{}).filter(x=>!period||x.period===period);const map=new Map();
  for(const e of entries){const code=clean(e.accountCode);const v=map.get(code)||{accountCode:code,debit:0,credit:0};v.debit=money(v.debit+money(e.debit));v.credit=money(v.credit+money(e.credit));map.set(code,v);}
  const rows=[...map.values()].map(x=>({...x,balance:money(x.debit-x.credit)}));return{period:period||"ALL",rows,totalDebit:money(rows.reduce((s,x)=>s+x.debit,0)),totalCredit:money(rows.reduce((s,x)=>s+x.credit,0))};
});

exports.getFinanceStatements=onCall({region:"us-central1"},async request=>{
  await actor(request);const period=clean(request.data?.period);const tb=await exports.getFinanceTrialBalance.run?null:null;
  const entries=(await db.collection("financeLedgerEntries").get()).docs.map(d=>d.data()||{}).filter(x=>!period||x.period===period);const accounts=(await db.collection("financeChartOfAccounts").get()).docs.map(d=>d.data()||{});const by=new Map(accounts.map(a=>[clean(a.code),a]));const totals={Asset:0,Liability:0,Equity:0,Income:0,Expense:0};
  for(const e of entries){const a=by.get(clean(e.accountCode));if(!a||!totals.hasOwnProperty(a.type))continue;const balance=money(e.debit)-money(e.credit);totals[a.type]=money(totals[a.type]+balance);}
  const surplus=money(totals.Income+totals.Expense);return{period:period||"ALL",income:totals.Income,expenses:totals.Expense,surplusOrDeficit:surplus,assets:totals.Asset,liabilities:totals.Liability,equity:totals.Equity,statementOfFinancialPositionCheck:money(totals.Asset-(totals.Liability+totals.Equity+surplus))};
});

exports.createFinanceThreeWayMatch=onCall({region:"us-central1"},async request=>{
  const a=await actor(request);const procurementId=clean(request.data?.procurementRequestId);const financeTransactionId=clean(request.data?.financeTransactionId);const invoiceAmount=money(request.data?.invoiceAmount);if(!procurementId||!financeTransactionId||invoiceAmount<=0)throw new HttpsError("invalid-argument","Procurement ID, Finance transaction ID and invoice amount are required.");
  const [p,t]=await Promise.all([db.collection("procurementRequests").doc(procurementId).get(),db.collection("financeTransactions").doc(financeTransactionId).get()]);if(!p.exists||!t.exists)throw new HttpsError("not-found","Procurement or Finance transaction record not found.");
  const poAmount=money(p.data()?.approvedAmount??p.data()?.amount);const financeAmount=money(t.data()?.amount);const matched=Math.abs(poAmount-financeAmount)<0.01&&Math.abs(financeAmount-invoiceAmount)<0.01;
  const ref=db.collection("financePaymentMatches").doc(financeTransactionId);await ref.set({procurementRequestId:procurementId,financeTransactionId,poAmount,financeAmount,invoiceAmount,matched,status:matched?"Matched":"Exception",checkedByUid:a.uid,checkedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
  const auditId=await createAudit(a,"FINANCE_THREE_WAY_MATCH",{procurementRequestId:procurementId,financeTransactionId,poAmount,financeAmount,invoiceAmount,matched});return{success:true,matched,status:matched?"Matched":"Exception",poAmount,financeAmount,invoiceAmount,auditId};
});

exports.validateFinanceDonorRestriction=onCall({region:"us-central1"},async request=>{
  await actor(request);const grantId=clean(request.data?.grantId);const amount=money(request.data?.amount);const category=clean(request.data?.category);if(!grantId||amount<=0||!category)throw new HttpsError("invalid-argument","Grant ID, amount and expenditure category are required.");
  const snap=await db.collection("financeGrants").doc(grantId).get();if(!snap.exists)throw new HttpsError("not-found","Grant record not found.");const g=snap.data()||{};const allowed=Array.isArray(g.allowedCategories)?g.allowedCategories.map(String):[];const remaining=money(money(g.awardAmount)-money(g.utilizedAmount));const categoryAllowed=!allowed.length||allowed.includes(category);return{grantId,allowed:categoryAllowed&&remaining>=amount,categoryAllowed,remainingBefore:remaining,remainingAfter:money(remaining-amount),restricted:g.restricted===true};
});

exports.registerFinanceAsset=onCall({region:"us-central1"},async request=>{
  const a=await actor(request);const d=request.data||{};const name=clean(d.name);const cost=money(d.cost);if(!name||cost<=0)throw new HttpsError("invalid-argument","Asset name and positive cost are required.");
  const ref=db.collection("financeAssets").doc();const assetNumber=`IRPA-AST-${new Date().getUTCFullYear()}-${ref.id.slice(0,6).toUpperCase()}`;await ref.set({assetNumber,name,cost,acquisitionDate:clean(d.acquisitionDate)||new Date().toISOString().slice(0,10),category:clean(d.category),location:clean(d.location),usefulLifeMonths:Math.max(1,Number(d.usefulLifeMonths||60)),depreciationMethod:"Straight-line",status:"Register",registeredByUid:a.uid,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});const auditId=await createAudit(a,"FINANCE_ASSET_REGISTERED",{assetNumber,name,cost});return{success:true,assetNumber,id:ref.id,auditId};
});

exports.calculateFinancePayroll=onCall({region:"us-central1"},async request=>{
  await actor(request);const gross=money(request.data?.gross);const deductions=money(request.data?.deductions);const employerContributions=money(request.data?.employerContributions);if(gross<0||deductions<0||employerContributions<0)throw new HttpsError("invalid-argument","Payroll values cannot be negative.");
  return{gross,deductions,netPay:money(gross-deductions),employerContributions,totalEmployerCost:money(gross+employerContributions),formula:"Net Pay = Gross Pay − Employee Deductions"};
});

exports.exportFinanceCsv=onCall({region:"us-central1"},async request=>{
  await actor(request);const source=clean(request.data?.source||"financeLedgerEntries");const allowed=["financeLedgerEntries","financeTransactions","financeBudgets","financeCommitments","financeAssets","financeJournalBatches"];if(!allowed.includes(source))throw new HttpsError("invalid-argument","Unsupported Finance export source.");
  const snap=await db.collection(source).get();const rows=snap.docs.map(d=>({id:d.id,...d.data()}));const keys=[...new Set(rows.flatMap(r=>Object.keys(r)))].filter(k=>!["createdAt","updatedAt"].includes(k));const csv=[keys.map(csvEscape).join(","),...rows.map(r=>keys.map(k=>{const v=r[k];return Array.isArray(v)||typeof v==="object"?JSON.stringify(v):v}).map(csvEscape).join(","))].join("\n");return{source,rowCount:rows.length,filename:`${source}-${new Date().toISOString().slice(0,10)}.csv`,csv};
});

exports.importFinanceCsvRows=onCall({region:"us-central1"},async request=>{
  const a=await actor(request);if(!a.isAdmin&&!a.roles.some(r=>["Director Finance & Administration","Finance Manager","Accountant","Finance Officer"].includes(r)))throw new HttpsError("permission-denied","Finance import authority is required.");
  const source=clean(request.data?.source);const rows=Array.isArray(request.data?.rows)?request.data.rows:[];const allowed=["financeBudgets","financeCommitments","financeTransactions"];if(!allowed.includes(source)||!rows.length||rows.length>500)throw new HttpsError("invalid-argument","Import requires 1–500 rows into an approved Finance register.");
  const writer=db.bulkWriter();let imported=0;for(const row of rows){if(!row||typeof row!=="object")continue;writer.set(db.collection(source).doc(),{...row,source:"CSV_IMPORT",importedByUid:a.uid,importedAt:FieldValue.serverTimestamp(),createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});imported++;}await writer.close();const auditId=await createAudit(a,"FINANCE_CSV_IMPORTED",{source,imported});return{success:true,source,imported,auditId};
});
