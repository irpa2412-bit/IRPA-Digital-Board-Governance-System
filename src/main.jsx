import React,{Component,useState}from"react";
import ReactDOM from"react-dom/client";
import App from"./App";
import InvitationActivation from"./pages/InvitationActivation";import MeetingEntryGateway from"./pages/MeetingEntryGateway";
import { logout } from "./firebase/auth";
import "./styles/app.css";
import "./styles/mobile-viewport-containment.css";
import "./styles/tokens.css";

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
      console.warn("IRPA offline application shell registration failed:", error);
    });
  });
}

class AppBootBoundary extends Component{
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return{error};}
  handleReload=()=>window.location.reload();
  handleSafeLogin=async()=>{
    try{await logout();}catch(error){console.error("IRPA safe-login session reset:",error);}
    try{
      window.sessionStorage.clear();
      window.localStorage.removeItem("irpaActiveAccessAuthority");
      window.localStorage.removeItem("irpaAccessAuthoritySelectionState");
      window.localStorage.removeItem("irpaPendingAccessAuthority");
      window.localStorage.removeItem("irpaAdminRedirectPending");
      window.localStorage.removeItem("irpaExpectedGoogleAdminEmail");
    }catch{}
    window.location.replace(window.location.origin+"/");
  };
  render(){
    if(this.state.error){
      return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,boxSizing:"border-box",background:"#07140f",color:"#edf5f1",fontFamily:"Inter,system-ui,sans-serif"}}>
        <section style={{width:"min(620px,100%)",padding:28,border:"1px solid #315a46",borderRadius:16,background:"#0a1d16",boxShadow:"0 20px 60px rgba(0,0,0,.35)"}}>
          <div style={{color:"#d6a52c",fontSize:11,fontWeight:800,letterSpacing:".14em"}}>IRPA DIGITAL BOARD GOVERNANCE SYSTEM</div>
          <h1 style={{margin:"10px 0 8px",fontSize:24}}>The workspace encountered a startup error.</h1>
          <p style={{margin:"0 0 18px",lineHeight:1.55,color:"#b9cbc4"}}>The workspace hit a runtime startup fault. The recovery path below returns the browser to a clean authentication session without changing IRPA authority or security rules.</p>
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
          <button type="button" onClick={this.handleSafeLogin} style={{background:"#0b5fa8",border:"1px solid #2f86cf",color:"#fff",borderRadius:10,padding:"11px 16px",fontWeight:700,cursor:"pointer"}}>Return to Safe Login</button>
          <button type="button" onClick={this.handleReload} style={{background:"transparent",border:"1px solid #315a46",color:"#edf5f1",borderRadius:10,padding:"11px 16px",fontWeight:700,cursor:"pointer"}}>Reload Workspace</button>
          </div>
        </section>
      </main>;
    }
    return this.props.children;
  }
}

const invitationRoute = new URL(window.location.href).searchParams.has("invitationToken");
const meetingRoute = new URL(window.location.href).searchParams.has("meetingToken");
function MeetingEntrySession(){const[entered,setEntered]=useState(false);if(entered)return <App/>;return <MeetingEntryGateway onEnter={meetingId=>{try{sessionStorage.setItem("irpaMeetingGatewayTarget",meetingId||"")}catch{}setEntered(true)}}/>}

ReactDOM.createRoot(document.getElementById("root"),{
  onUncaughtError:(error)=>console.error("IRPA application startup error",error)
}).render(
  <React.StrictMode>
    <AppBootBoundary>
      {invitationRoute ? <InvitationActivation /> : meetingRoute ? <MeetingEntrySession/> : <App />}
    </AppBootBoundary>
  </React.StrictMode>
);