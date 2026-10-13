import React from "react";
import { createRoot } from "react-dom/client";
import FundraisingSourceRegistry from "../../src/pages/grant-fundraising/FundraisingSourceRegistry.jsx";

function Harness() {
  return <div>
    <h1 style={{ fontSize: 20 }}>Fundraising portal responsive regression harness</h1>
    <FundraisingSourceRegistry onResearchSource={(source) => { window.__selectedResearchSource = source; }} />
  </div>;
}

createRoot(document.getElementById("root")).render(<Harness />);
