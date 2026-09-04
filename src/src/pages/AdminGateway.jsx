import React, { useState } from "react";
import {
  sendAdminMagicLink,
  loginWithEmail
} from "../firebase/auth";

export default function AdminGateway() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState("link");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleMagicLink(event) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await sendAdminMagicLink(email);

      setMessage(
        "Administrator sign-in link sent. Please check your email."
      );
    } catch (err) {
      setError(
        err.message ||
          "Unable to send administrator sign-in link."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordLogin(event) {
    event.preventDefault();

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await loginWithEmail(email, password);

      setMessage(
        "Administrator authentication successful."
      );
    } catch (err) {
      setError(
        err.message ||
          "Unable to authenticate administrator."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="auth-card">

      <div className="brand-block">
        <h1>IRPA</h1>

        <p>
          Digital Board Governance System
        </p>
      </div>

      <h2>
        Administrator Gateway
      </h2>

      <p>
        Secure preliminary access for authorised
        IRPA administrators.
      </p>

      {message && (
        <div className="success-message">
          {message}
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div
        style={{
          display: "flex",
          gap: "8px",
          marginBottom: "20px"
        }}
      >
        <button
          type="button"
          onClick={() => {
            setMode("link");
            setError("");
            setMessage("");
          }}
          style={{
            flex: 1,
            opacity: mode === "link" ? 1 : 0.6
          }}
        >
          One-Time Sign-In Link
        </button>

        <button
          type="button"
          onClick={() => {
            setMode("password");
            setError("");
            setMessage("");
          }}
          style={{
            flex: 1,
            opacity:
              mode === "password" ? 1 : 0.6
          }}
        >
          Password Sign-In
        </button>
      </div>

      {mode === "link" ? (
        <form onSubmit={handleMagicLink}>

          <div className="form-field">
            <label>
              Authorised Administrator Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              placeholder="administrator@example.org"
              required
            />
          </div>

          <button
            type="submit"
            disabled={busy}
          >
            {busy
              ? "Sending..."
              : "Send One-Time Sign-In Link"}
          </button>

        </form>
      ) : (
        <form onSubmit={handlePasswordLogin}>

          <div className="form-field">
            <label>
              Administrator Email
            </label>

            <input
              type="email"
              value={email}
              onChange={(event) =>
                setEmail(event.target.value)
              }
              required
            />
          </div>

          <div className="form-field">
            <label>
              Password
            </label>

            <input
              type="password"
              value={password}
              onChange={(event) =>
                setPassword(event.target.value)
              }
              required
            />
          </div>

          <button
            type="submit"
            disabled={busy}
          >
            {busy
              ? "Signing in..."
              : "Sign In as Administrator"}
          </button>

        </form>
      )}

      <div
        style={{
          marginTop: "22px",
          padding: "14px",
          background: "#0a1b15",
          border: "1px solid #214337",
          borderRadius: "8px"
        }}
      >
        <strong>
          Security Notice
        </strong>

        <p
          style={{
            marginBottom: 0,
            color: "#91a9a0",
            fontSize: "13px"
          }}
        >
          Authentication alone does not grant
          administrator privileges. Access is
          subsequently verified against the IRPA
          administrator profile.
        </p>
      </div>

    </section>
  );
}
