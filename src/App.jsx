import React, { useEffect, useState } from "react";

import Invitations from "./pages/Invitations";

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

import { getAdminProfile } from "./firebase/data";

const modules = [
  "Dashboard",
  "Members",
  "Invitations",
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
  "Risk Register",
  "Finance Portfolio",
  "Reports",
  "Audit Trail",
  "Settings"
];

function AuthScreen() {
  const [mode, setMode] = useState("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();

    setMessage("");
    setBusy(true);

    try {
      if (mode === "register") {
        await registerWithEmail(email.trim(), password);

        setMessage(
          "Account created. Please verify your email before continuing."
        );
      } else {
        await loginWithEmail(email.trim(), password);
      }
    } catch (error) {
      setMessage(error.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function googleLogin() {
    setMessage("");
    setBusy(true);

    try {
      await loginWithGoogle();
    } catch (error) {
      setMessage(error.message || "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resetPassword() {
    if (!email.trim()) {
      setMessage("Enter your email address first.");
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      await sendPasswordReset(email.trim());

      setMessage("Password reset email sent.");
    } catch (error) {
      setMessage(
        error.message || "Unable to send password reset email."
      );
    } finally {
      setBusy(false);
    }
  }

  async function adminLink() {
    if (!email.trim()) {
      setMessage(
        "Enter the authorised administrator email address."
      );
      return;
    }

    setBusy(true);
    setMessage("");

    try {
      await sendAdminMagicLink(email.trim());

      setMessage(
        "Administrator sign-in link sent. Please check the authorised email account."
      );
    } catch (error) {
      setMessage(
        error.message || "Unable to send administrator sign-in link."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">

        <div className="brand-mark">
          IRPA
        </div>

        <h1>
          Digital Board Governance
        </h1>

        <p className="auth-subtitle">
          Secure governance workspace for IRPA members and administrators.
        </p>

        <form onSubmit={submit}>

          <label>
            Email address
          </label>

          <input
            type="email"
            value={email}
            onChange={(event) =>
              setEmail(event.target.value)
            }
            placeholder="name@example.org"
            autoComplete="email"
            required
          />

          <label>
            Password
          </label>

          <input
            type="password"
            value={password}
            onChange={(event) =>
              setPassword(event.target.value)
            }
            placeholder="Password"
            autoComplete={
              mode === "register"
                ? "new-password"
                : "current-password"
            }
            required
            minLength={6}
          />

          <button
            type="submit"
            disabled={busy}
          >
            {busy
              ? "Please wait..."
              : mode === "register"
                ? "Create Account"
                : "Sign In"}
          </button>

        </form>

        <button
          className="secondary-button"
          onClick={googleLogin}
          disabled={busy}
          type="button"
        >
          Continue with Google
        </button>

        <button
          className="text-button"
          onClick={resetPassword}
          disabled={busy}
          type="button"
        >
          Forgot password?
        </button>

        <button
          className="text-button"
          onClick={adminLink}
          disabled={busy}
          type="button"
        >
          Administrator Gateway
        </button>

        <button
          className="text-button"
          onClick={() => {
            setMode(
              mode === "login"
                ? "register"
                : "login"
            );

            setMessage("");
          }}
          disabled={busy}
          type="button"
        >
          {mode === "login"
            ? "Create a member account"
            : "Return to sign in"}
        </button>

        {message && (
          <div className="auth-message">
            {message}
          </div>
        )}

      </section>
    </main>
  );
}

function AccessDenied({ user, reason }) {
  async function handleLogout() {
    await logout();
  }

  return (
    <main className="auth-screen">

      <section className="auth-card">

        <div className="brand-mark">
          IRPA
        </div>

        <h1>
          Administrator Access Required
        </h1>

        <p className="auth-subtitle">
          Your Firebase account has been authenticated, but it has not been authorised as an active IRPA administrator.
        </p>

        <div className="error-message">
          {reason ||
            "No active administrator profile was found for this account."}
        </div>

        <div
          style={{
            marginTop: "18px",
            padding: "14px",
            border: "1px solid #214337",
            borderRadius: "8px",
            background: "#0a1b15"
          }}
        >
          <strong>
            Authenticated account
          </strong>

          <p
            style={{
              marginBottom: 0,
              marginTop: "8px",
              color: "#91a9a0"
            }}
          >
            {user?.email || "Unknown account"}
          </p>
        </div>

        <button
          type="button"
          onClick={handleLogout}
          style={{ marginTop: "18px" }}
        >
          Sign Out
        </button>

      </section>

    </main>
  );
}

function AdministratorLoading() {
  return (
    <div className="loading-screen">
      Verifying administrator authorization...
    </div>
  );
}

function AppShell({ user, adminProfile }) {
  const [activeModule, setActiveModule] =
    useState("Dashboard");

  async function handleLogout() {
    await logout();
  }

  return (
    <div className="app-shell">

      <aside className="sidebar">

        <div className="sidebar-brand">

          <div className="brand-mark">
            IRPA
          </div>

          <div>
            <strong>
              IRPA
            </strong>

            <span>
              Digital Governance
            </span>
          </div>

        </div>

        <div
          style={{
            margin: "0 12px 16px",
            padding: "10px 12px",
            borderRadius: "8px",
            background: "#0a1b15",
            border: "1px solid #214337",
            fontSize: "12px"
          }}
        >
          <strong>
            ADMINISTRATOR
          </strong>

          <div
            style={{
              marginTop: "4px",
              color: "#91a9a0"
            }}
          >
            {adminProfile?.role ||
              "Active Administrator"}
          </div>
        </div>

        <nav>

          {modules.map((module) => (
            <button
              key={module}
              type="button"
              className={
                activeModule === module
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() =>
                setActiveModule(module)
              }
            >
              {module}
            </button>
          ))}

        </nav>

        <button
          className="logout-button"
          onClick={handleLogout}
          type="button"
        >
          Sign Out
        </button>

      </aside>

      <section className="main-area">

        <header className="topbar">

          <div>
            <h2>
              {activeModule}
            </h2>

            <p>
              IRPA Digital Board Governance Workspace
            </p>
          </div>

          <div className="user-info">

            <span>
              {adminProfile?.name ||
                user.email}
            </span>

          </div>

        </header>

        <main className="content-area">

          {activeModule === "Dashboard" ? (

            <Dashboard
              adminProfile={adminProfile}
            />

          ) : activeModule === "Invitations" ? (

            <Invitations />

          ) : (

            <ModulePlaceholder
              name={activeModule}
            />

          )}

        </main>

      </section>

    </div>
  );
}

function Dashboard({ adminProfile }) {
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

        <h1>
          Governance Dashboard
        </h1>

        <p>
          Central workspace for IRPA Board and governance activities.
        </p>

        <div
          style={{
            marginTop: "12px",
            fontSize: "13px",
            color: "#91a9a0"
          }}
        >
          Administrator:{" "}
          <strong>
            {adminProfile?.name ||
              adminProfile?.email ||
              "Authorised Administrator"}
          </strong>
        </div>

      </div>

      <div className="dashboard-grid">

        {cards.map(([label, value]) => (
          <div
            className="stat-card"
            key={label}
          >
            <span>
              {label}
            </span>

            <strong>
              {value}
            </strong>
          </div>
        ))}

      </div>

    </div>
  );
}

function ModulePlaceholder({ name }) {
  return (
    <section className="module-panel">

      <h1>
        {name}
      </h1>

      <p>
        This module is connected to the IRPA governance workspace.
      </p>

      <div className="module-status">

        <strong>
          Module foundation ready
        </strong>

        <span>
          Functional workflow and Firebase data integration will be implemented here.
        </span>

      </div>

    </section>
  );
}

export default function App() {
  const [user, setUser] =
    useState(undefined);

  const [adminProfile, setAdminProfile] =
    useState(undefined);

  const [authorizationError, setAuthorizationError] =
    useState("");

  useEffect(() => {

    const unsubscribe =
      observeAuthState(async (currentUser) => {

        setUser(currentUser);
        setAdminProfile(undefined);
        setAuthorizationError("");

        if (!currentUser) {
          return;
        }

        try {

          const profile =
            await getAdminProfile(
              currentUser.uid
            );

          if (!profile) {

            setAuthorizationError(
              "This account is authenticated but has no administrator profile in IRPA."
            );

            setAdminProfile(null);

            return;
          }

          if (profile.active !== true) {

            setAuthorizationError(
              "The administrator profile exists, but it is not active."
            );

            setAdminProfile(null);

            return;
          }

          setAdminProfile(profile);

        } catch (error) {

          console.error(
            "Administrator authorization error:",
            error
          );

          setAuthorizationError(
            error.message ||
              "Unable to verify administrator authorization."
          );

          setAdminProfile(null);
        }

      });

    return () => unsubscribe();

  }, []);

  useEffect(() => {

    async function processMagicLink() {

      if (!isMagicLink()) {
        return;
      }

      const storedEmail =
        window.localStorage.getItem(
          "irpaEmailForSignIn"
        );

      if (!storedEmail) {
        return;
      }

      try {

        await completeMagicLink(
          storedEmail
        );

        window.localStorage.removeItem(
          "irpaEmailForSignIn"
        );

      } catch (error) {

        console.error(
          "Magic-link completion failed:",
          error
        );

      }

    }

    processMagicLink();

  }, []);

  if (user === undefined) {

    return (
      <div className="loading-screen">
        Loading IRPA Governance System...
      </div>
    );

  }

  if (!user) {
    return <AuthScreen />;
  }

  if (adminProfile === undefined) {
    return <AdministratorLoading />;
  }

  if (!adminProfile) {

    return (
      <AccessDenied
        user={user}
        reason={authorizationError}
      />
    );

  }

  return (
    <AppShell
      user={user}
      adminProfile={adminProfile}
    />
  );
}
