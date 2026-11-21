import React, { Component } from "react";

export default class SignaturePathwaySelfTestErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error) {
    console.error("Signature Pathway Self-Test panel failed", { code: "SELF_TEST_PANEL_ERROR", name: error?.name || "Error" });
  }
  render() {
    if (this.state.failed) {
      return <section className="panel" role="alert" aria-live="assertive">
        <strong>Signature Pathway Self-Test</strong>
        <p>Self-test failed: SELF_TEST_PANEL_ERROR</p>
      </section>;
    }
    return this.props.children;
  }
}
