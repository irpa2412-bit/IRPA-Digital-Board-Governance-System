const admin=require("../functions/node_modules/firebase-admin");
const projectId=process.env.GCLOUD_PROJECT||process.env.GOOGLE_CLOUD_PROJECT||"demo-irpa-dgbs";
const email="irpa-browser-fixture-admin@example.test",password="FixtureOnly-Password-2026!";
async function main(){
 if(!process.env.FIREBASE_AUTH_EMULATOR_HOST||!process.env.FIRESTORE_EMULATOR_HOST)throw new Error("Both Firebase emulators are required.");
 admin.initializeApp({projectId});const user=await admin.auth().createUser({email,password,emailVerified:true,displayName:"IRPA Browser Fixture Administrator"}),db=admin.firestore();
 await db.collection("adminProfiles").doc(user.uid).set({uid:user.uid,email,name:"IRPA Browser Fixture Administrator",role:"Administrator",active:true,status:"active",createdAt:new Date().toISOString(),fixtureOnly:true});
 const docs=[
 ["fixture-tz",{title:"Tanzania Pastoral Rangeland Resilience Grant",funder:"Fixture Foundation",summary:"Community-led rangeland restoration and pastoral livelihoods in Tanzania.",country:"Tanzania",amount:"USD 50,000",status:"Open",pillars:["sustainable_rangeland_management"],themes:[],url:"https://example.test/tz",sourceType:"Manual"}],
 ["fixture-outside",{title:"East Africa Regional Biodiversity Fund",funder:"Fixture Foundation",summary:"Regional biodiversity support.",country:"Kenya",amount:"USD 25,000",status:"Open",pillars:[],themes:[],url:"https://example.test/ke",sourceType:"Manual"}],
 ["fixture-missing",{title:"Pastoral Community Innovation Opportunity",funder:"Fixture Foundation",summary:"Limited details.",country:"",amount:"",status:"Open",pillars:[],themes:[],url:"https://example.test/missing",sourceType:"Manual"}]
 ];
 const batch=db.batch();docs.forEach(([id,data],i)=>batch.set(db.collection("grantOpportunities").doc(id),{...data,fixtureOnly:true,createdAt:new Date(Date.now()-i*1000).toISOString()}));await batch.commit();
 console.log("Seeded emulator-only administrator and 3 grant opportunities.");await db.terminate();await admin.app().delete();
}main().catch(e=>{console.error(e);process.exitCode=1;});
