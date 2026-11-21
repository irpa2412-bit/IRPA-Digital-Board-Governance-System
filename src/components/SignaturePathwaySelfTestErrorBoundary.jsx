import React, { Component } from "react";

export default class SignaturePathwaySelfTestErrorBoundary extends Component {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error) {
    console.error("Signature Pathway Self-Test panel failed safely", {
      name: String(error?.name || "Error").slice(0, 80),
      code: String(error?.code || "SELF_TEST_PANEL_ERROR").slice(0, 80)
    });
  }
  render() {
    if (this.state.failed) return <section className="panel" role="alert" aria-live="assertive">
      <h2>Signature Pathway Self-Test unavailable</h2>
      <p>The diagnostic panel encountered an error. The rest of the workspace remains available. Reload the panel or continue using the workspace.</p>
      <button type="button" onClick={() => this.setState({ failed: false })}>Retry self-test panel</button>
    </section>;
    return this.props.children;
  }
}
