import React from "react";
import { createRoot } from "react-dom/client";
import "../../src/styles/tokens.css";
import "../../src/styles/app.css";
import "../../src/styles/page-layout-stability.css";
import "../../src/styles/mobile-viewport-containment.css";
import "../../src/styles/portal-readability-standard.css";

function PortalLayoutFixture() {
  return (
    <div className="app-shell" data-audit-root>
      <aside className="sidebar" aria-label="Primary portal navigation">
        <h2>IRPA Governance</h2>
        <button type="button">Dashboard</button>
        <button type="button">Meetings and decisions</button>
        <button type="button">Documents and records</button>
        <button type="button">Communications and media</button>
      </aside>
      <div className="main-area">
        <header className="topbar">
          <div className="topbar-heading-row">
            <div className="topbar-title-block">
              <span className="topbar-kicker">IRPA DIGITAL GOVERNANCE</span>
              <h2>Board Governance System</h2>
              <p>Portal layout responsive audit fixture</p>
            </div>
            <div className="topbar-access-category">
              <span>ACCESS CATEGORY</span>
              <div aria-label="Login category"><span>Board Administrator</span></div>
            </div>
            <div className="user-info">
              <div className="user-avatar">IR</div>
              <div><strong>IRPA Administrator</strong><span>Signed in</span></div>
            </div>
          </div>
        </header>
        <main className="content-area">
          <section className="page">
            <header className="page-header">
              <div>
                <h1>IRPA Portal Layout Fixture</h1>
                <p>Representative dashboard, navigation, form and table patterns</p>
              </div>
              <button type="button" className="global-home-button">Return to dashboard</button>
            </header>
            <section className="welcome-panel">
              <div>
                <span className="eyebrow">GOVERNANCE OVERVIEW</span>
                <h2>Board and programme workspace</h2>
                <p>Review actions, records and programme information across the organisation</p>
              </div>
              <div className="identity-card">
                <span>Current workspace</span>
                <strong>IRPA Board Office</strong>
              </div>
            </section>
            <section className="dashboard-grid" aria-label="Dashboard summary">
              <article className="stat-card"><span>Open actions</span><strong>12</strong><small>Across board committees</small></article>
              <article className="stat-card"><span>Pending decisions</span><strong>4</strong><small>Awaiting review</small></article>
              <article className="stat-card"><span>Records archived</span><strong>86</strong><small>Controlled records</small></article>
            </section>
            <section className="panel">
              <div className="panel-header">
                <h2>Recent governance records</h2>
                <input className="table-search" aria-label="Search governance records" placeholder="Search records" />
              </div>
              <div className="table-wrapper" data-audit-scroll-region>
                <table>
                  <thead><tr><th>Reference</th><th>Record title</th><th>Committee</th><th>Owner</th><th>Status</th><th>Last updated</th></tr></thead>
                  <tbody>
                    <tr><td>IRPA-BOARD-2026-001</td><td>Board meeting minutes and resolutions</td><td>Board</td><td>Board Secretary</td><td><span className="status-badge">Approved</span></td><td>10 Nov 2026</td></tr>
                    <tr><td>IRPA-PROG-2026-014</td><td>Longido rangeland restoration progress report</td><td>Programmes</td><td>Programme Lead</td><td><span className="status-badge">Under review</span></td><td>09 Nov 2026</td></tr>
                  </tbody>
                </table>
              </div>
            </section>
            <section className="panel">
              <div className="panel-header"><h2>Record submission</h2></div>
              <div className="form-grid">
                <div className="form-field"><label htmlFor="record-title">Record title</label><input id="record-title" placeholder="Enter a record title" /></div>
                <div className="form-field"><label htmlFor="record-type">Record type</label><select id="record-type"><option>Meeting record</option><option>Programme report</option></select></div>
                <div className="form-field form-field-wide"><label htmlFor="record-notes">Notes</label><textarea id="record-notes" rows="3" placeholder="Add a short description" /></div>
              </div>
              <div className="form-actions"><button type="button">Save draft</button><button type="button" className="secondary-button">Cancel</button></div>
            </section>
          </section>
        </main>
      </div>
      <nav className="mobile-global-nav" aria-label="Mobile navigation">
        <button type="button" className="active">Home</button>
        <button type="button">Portals</button>
        <button type="button">Tasks</button>
        <button type="button">Profile</button>
      </nav>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<PortalLayoutFixture />);
