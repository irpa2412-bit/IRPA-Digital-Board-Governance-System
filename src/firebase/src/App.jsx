import React, { useEffect, useState } from "react";
import Members from "./pages/Members";

import {
  observeAuthState,
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  sendPasswordReset,
  sendAdminMagicLink,
  isMagicLink,
  completeMagicLink,
  logout
} from "./firebase/auth";

const NAVIGATION = [
  {
    title: "Governance",
    items: [
      "Dashboard",
      "Members",
      "Participants",
      "Meetings",
      "Meeting Room",
      "Transcription & Proceedings",
      "Resolutions",
      "Voting",
      "Actions",
      "Documents",
      "Signature Platform",
      "Decisions",
      "Risk Register"
    ]
  },
  {
    title: "Finance",
    items: ["Finance Portfolio"]
  },
  {
    title: "Evidence",
    items: ["Reports", "Audit Trail"]
  },
  {
    title: "System",
    items: ["Settings"]
  }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [activeModule, setActiveModule] = useState("Dashboard");

  const [authMode, setAuthMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsubscribe = observeAuthState((currentUser) => {
      setUser(currentUser);
      setAuthLoading(false);
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!isMagicLink()) {
      return;
    }

    const storedEmail = window.localStorage.getItem(
      "irpaEmailForSignIn"
    );

    if (!storedEmail) {
      setMessage(
        "Magic link detected. Please enter the authorised email address."
      );
      return;
    }

    completeMagicLink(storedEmail)
      .then(() => {
        window.localStorage.removeItem("irpaEmailForSignIn");
        setMessage("Administrator sign-in successful.");
      })
      .catch((err) => {
        setError(err.message || "Unable to complete administrator sign-in.");
      });
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await loginWithEmail(email, password);
      setMessage("Signed in successfully.");
    } catch (err) {
      setError(err.message || "Unable to sign in.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRegister(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await registerWithEmail(email, password);
      setMessage(
        "Registration successful. Please check your email for verification."
      );
    } catch (err) {
      setError(err.message || "Unable to register.");
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogleLogin() {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await loginWithGoogle();
      setMessage("Google sign-in successful.");
    } catch (err) {
      setError(err.message || "Unable to sign in with Google.");
    } finally {
      setBusy(false);
    }
  }

  async function handlePasswordReset() {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await sendPasswordReset(email);
      setMessage("Password reset instructions have been sent.");
    } catch (err) {
      setError(err.message || "Unable to send password reset email.");
    } finally {
      setBusy(false);
    }
  }

  async function handleAdminMagicLink() {
    if (!email) {
      setError("Enter the authorised administrator email address.");
      return;
    }

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await sendAdminMagicLink(email);
      setMessage(
        "Administrator sign-in link sent. Check your email."
      );
    } catch (err) {
      setError(
        err.message || "Unable to send administrator sign-in link."
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    await logout();
    setActiveModule("Dashboard");
  }

  if (authLoading) {
    return (
      <div className="app-shell">
        <div className="loading-screen">
          Loading IRPA Digital Board Governance System...
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="app-shell">
        <div className="auth-card">
          <div className="brand-block">
            <h1>IRPA</h1>
            <p>Digital Board Governance System</p>
          </div>

          <h2>
            {authMode === "register"
              ? "Create Account"
              : "Sign In"}
          </h2>

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

          <form
            onSubmit={
              authMode === "register"
                ? handleRegister
                : handleLogin
            }
          >
            <div className="form-field">
              <label>Email Address</label>
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
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(event) =>
                  setPassword(event.target.value)
                }
                required
              />
            </div>

            <button type="submit" disabled={busy}>
              {busy
                ? "Please wait..."
                : authMode === "register"
                ? "Create Account"
                : "Sign In"}
            </button>
          </form>

          <button
            type="button"
            className="secondary-button"
            onClick={handleGoogleLogin}
            disabled={busy}
          >
            Continue with Google
          </button>

          <button
            type="button"
            className="secondary-button"
            onClick={handleAdminMagicLink}
            disabled={busy}
          >
            Send Administrator Sign-In Link
          </button>

          {authMode === "login" && (
            <button
              type="button"
              className="text-button"
              onClick={handlePasswordReset}
              disabled={busy}
            >
              Forgot Password?
            </button>
          )}

          <button
            type="button"
            className="text-button"
            onClick={() => {
              setAuthMode(
                authMode === "login"
                  ? "register"
                  : "login"
              );
              setError("");
              setMessage("");
            }}
          >
            {authMode === "login"
              ? "Create a new account"
              : "Already have an account? Sign in"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>IRPA</h1>
          <p>Digital Board Governance</p>
        </div>

        <nav className="sidebar-nav">
          {NAVIGATION.map((section) => (
            <div
              className="nav-section"
              key={section.title}
            >
              <div className="nav-section-title">
                {section.title}
              </div>

              {section.items.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={
                    activeModule === item
                      ? "nav-item active"
                      : "nav-item"
                  }
                  onClick={() => setActiveModule(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            {user.email}
          </div>

          <button
            type="button"
            className="logout-button"
            onClick={handleLogout}
          >
            Sign Out
          </button>
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div>
            <h2>{activeModule}</h2>
            <p>IRPA Digital Board Governance Workspace</p>
          </div>

          <div className="user-info">
            <span>{user.email}</span>
          </div>
        </header>

        <main className="content-area">
          {activeModule === "Dashboard" ? (
            <Dashboard />
          ) : activeModule === "Members" ? (
            <Members />
          ) : (
            <ModulePlaceholder name={activeModule} />
          )}
        </main>
      </section>
    </div>
  );
}

function Dashboard() {
  const cards = [
    ["Members", "0"],
    ["Meetings", "0"],
    ["Pending Decisions", "0"],
    ["Open Actions", "0"],
    ["Documents", "0"],
    ["Active Risks", "0"]
  ];

  return (
    <div>
      <div className="welcome-panel">
        <h1>Governance Dashboard</h1>
        <p>
          Central workspace for IRPA Board and governance activities.
        </p>
      </div>

      <div className="dashboard-grid">
        {cards.map(([title, value]) => (
          <div className="stat-card" key={title}>
            <span>{title}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}

function ModulePlaceholder({ name }) {
  return (
    <section className="module-panel">
      <div className="module-header">
        <div>
          <h1>{name}</h1>
          <p>
            This governance module is ready for implementation.
          </p>
        </div>
      </div>
    </section>
  );
}
