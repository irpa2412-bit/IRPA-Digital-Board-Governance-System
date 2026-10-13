import React from "react";
import { createRoot } from "react-dom/client";
import Meetings from "../../src/pages/Meetings.jsx";
import "../../src/styles/app.css";
import "../../src/styles/mobile-viewport-containment.css";
import "../../src/styles/tokens.css";
import "../../src/styles/portal-typography.css";
import "../../src/styles/shared-header-hero.css";
import "../../src/styles/mobile-app-enhancement.css";
import "../../src/styles/page-back-next-navigation.css";
import "../../src/styles/grant-intelligence-layout.css";
createRoot(document.getElementById("root")).render(
  <React.StrictMode><Meetings onNavigate={() => {}} /></React.StrictMode>
);
