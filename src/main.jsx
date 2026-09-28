import React,{Component}from"react";
import ReactDOM from"react-dom/client";
import App from"./App";
import "./styles/app.css";

class AppBootBoundary extends Component{
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return{error};}
  handleReload=()=>window.location.reload();
  render(){
    if(this.state.error){
      return <main style={{minHeight:"100vh",display:"grid",placeItems:"center",padding:24,boxSizing:"border-box",background:"#07140f",color:"#edf5f1",fontFamily:"Inter,system-ui,sans-serif"}}>
        <section style={{width:"min(620px,100%)",padding:28,border:"1px solid #315a46",borderRadius:16,background:"#0a1d16",boxShadow:"0 20px 60px rgba(0,0,0,.35)"}}>
          <div style={{color:"#d6a52c",fontSize:11,fontWeight:800,letterSpacing:".14em"}}>IRPA DIGITAL BOARD GOVERNANCE SYSTEM</div>
          <h1 style={{margin:"10px 0 8px",fontSize:24}}>The workspace encountered a startup error.</h1>
          <p style={{margin:"0 0 18px",lineHeight:1.55,color:"#b9cbc4"}}>The application was prevented from disappearing to a blank screen. Reload the workspace to try again.</p>
          <button type="button" onClick={this.handleReload} style={{background:"#0b5fa8",border:"1px solid #2f86cf",color:"#fff",borderRadius:10,padding:"11px 16px",fontWeight:700,cursor:"pointer"}}>Reload IRPA Workspace</button>
        </section>
      </main>;
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root"),{
  onUncaughtError:(error)=>console.error("IRPA application startup error",error)
}).render(
  <React.StrictMode>
    <AppBootBoundary>
      <App />
    </AppBootBoundary>
  </React.StrictMode>
);