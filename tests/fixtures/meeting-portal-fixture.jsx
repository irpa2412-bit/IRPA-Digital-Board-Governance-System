import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import Meetings from "../../src/pages/Meetings.jsx";
import MeetingRoom from "../../src/pages/MeetingRoom.jsx";
import { setFixtureActor } from "./mocks.js";
import "./meeting-portal-fixture.css";
import "../../src/styles/app.css";
import "../../src/styles/mobile-viewport-containment.css";
import "../../src/styles/tokens.css";
import "../../src/styles/portal-typography.css";
import "../../src/styles/shared-header-hero.css";
import "../../src/styles/mobile-app-enhancement.css";
import "../../src/styles/page-back-next-navigation.css";
import "../../src/styles/grant-intelligence-layout.css";

function FixtureApp() {
  const [screen, setScreen] = useState("meetings");
  const [navigation, setNavigation] = useState(null);
  const [actorVersion, setActorVersion] = useState(0);
  const onNavigate = (module, context = {}) => {
    window.__irpaNavigationCalls = [...(window.__irpaNavigationCalls || []), { module, context }];
    setNavigation({ module, context });
    if (module === "Meeting Room") setScreen("meeting-room");
    else setScreen("meetings");
  };
  return <main data-testid="meeting-fixture-root" data-fixture="TEST-ONLY">
    <div className="meeting-fixture-banner" role="note">
      TEST ENVIRONMENT — isolated browser fixture. Local test records only. No production Firestore, Drive, SMTP or email delivery.
    </div>
    {screen === "meeting-room" ? <>
      <div className="meeting-fixture-controls">
        <button type="button" onClick={() => { setFixtureActor("host"); setActorVersion(v => v + 1); }}>TEST: restore host</button>
        <button type="button" onClick={() => { setFixtureActor("outsider"); setActorVersion(v => v + 1); }}>TEST: switch to outsider</button>
        <span data-testid="fixture-actor-version">{actorVersion}</span>
      </div>
      <MeetingRoom key={actorVersion} onNavigate={onNavigate}/>
    </> : <Meetings onNavigate={onNavigate}/>}
    {navigation && <output data-testid="fixture-last-navigation" data-module={navigation.module}>{navigation.module}</output>}
  </main>;
}
createRoot(document.getElementById("root")).render(<React.StrictMode><FixtureApp/></React.StrictMode>);
