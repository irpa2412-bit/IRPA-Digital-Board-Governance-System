import React from "react";
import { createRoot } from "react-dom/client";
import Invitations from "../../src/pages/Invitations.jsx";
import Meetings from "../../src/pages/Meetings.jsx";
import DocumentLifecycleModule from "../../src/pages/DocumentLifecycleModule.jsx";
import SignaturePlatform from "../../src/pages/SignaturePlatform.jsx";
import AuthorizationApprovals from "../../src/pages/AuthorizationApprovals.jsx";
import FinancePortfolio from "../../src/pages/FinancePortfolio.jsx";
import ProcurementPortal from "../../src/pages/ProcurementPortal.jsx";
import Employees from "../../src/pages/Employees.jsx";
import "../../src/styles/app.css";
import "../../src/styles/tokens.css";
import "../../src/styles/portal-typography.css";
import "../../src/styles/shared-header-hero.css";
import "../../src/styles/mobile-viewport-containment.css";
import "../../src/styles/mobile-app-enhancement.css";
import "../../src/styles/portal-readability-standard.css";
import "../../src/styles/finance-platform-uniform.css";

const profile = { role:"Administrator", title:"Administrator", position:"Administrator", department:"Finance & Administration", unit:"Finance Unit", authorizationType:"administrator", status:"Active", permissions:["RESTRICTED_DOCUMENT_UPLOAD"] };
const employee = { ...profile, employeeNumber:"FIXTURE-001", name:"Responsive Audit Fixture" };
const noop = () => {};
const pages = {
  "Invitation": () => <Invitations />,
  "Meeting": () => <Meetings onNavigate={noop} />,
  "Documents": () => <DocumentLifecycleModule profile={profile} employee={employee} admin={true} />,
  "Signature": () => <SignaturePlatform />,
  "Authorization": () => <AuthorizationApprovals />,
  "Finance": () => <FinancePortfolio profile={profile} employee={employee} isAdmin={true} />,
  "Procurement": () => <ProcurementPortal profile={profile} />,
  "Employees": () => <Employees />
};
class Boundary extends React.Component {
  constructor(props){super(props);this.state={error:null};}
  static getDerivedStateFromError(error){return {error};}
  componentDidCatch(error){window.__portalFixtureError=String(error?.message||error);}
  render(){return this.state.error?<section role="alert"><h2>Portal fixture render error</h2><pre>{String(this.state.error?.message||this.state.error)}</pre></section>:this.props.children;}
}
const params = new URLSearchParams(window.location.search);
const selected = params.get("portal") || "Meeting";
const Render = pages[selected] || pages.Meeting;
createRoot(document.getElementById("root")).render(<Boundary><div className="app-shell"><aside className="sidebar" aria-hidden="true" /><div className="main-area"><div className="content-area"><main data-portal-name={selected} style={{minWidth:0,padding:12}}><header style={{marginBottom:12,background:"#ffffff",color:"#172033",padding:12,borderRadius:8}}><span>IRPA DBGS LOCAL RESPONSIVE FIXTURE</span><h1>{selected} Portal</h1><p>Read-only layout fixture. External requests are blocked by the Playwright runner.</p></header><Render /></main></div></div></div></Boundary>);
