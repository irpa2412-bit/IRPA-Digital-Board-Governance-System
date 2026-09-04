import Members from "./pages/Members";
import React, { useEffect, useState } from "react";
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

const modules = [
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

  async function submit(e) {
    e.preventDefault();
    setMessage("");
    setBusy(true);

    try {
      if (mode === "register") {
        await registerWithEmail(email, password);
        setMessage("Account created. Please verify your email.");
      } else {
        await loginWithEmail(email, password);
      }
    } catch (error) {
      setMessage(error.message || "Authentication failed.");
    } finally {
      setBusy(false);
    }
  }

  async function googleLogin() {
    setMessage("");
    try {
      await loginWithGoogle();
    } catch (error) {
      setMessage(error.message || "Google sign-in failed.");
    }
  }

  async function resetPassword() {
    if (!email) {
      setMessage("Enter your email address first.");
      return;
    }

    try {
      await sendPasswordReset(email);
      setMessage("Password reset email sent.");
    } catch (error) {
      setMessage(error.message || "Unable to send reset email.");
    }
  }

  async function adminLink() {
    if (!email) {
      setMessage("Enter the authorised administrator email.");
      return;
    }

    try {
      await sendAdminMagicLink(email);
      setMessage("Administrator sign-in link sent.");
    } catch (error) {
      setMessage(error.message || "Unable to send administrator link.");
    }
  }

  return (
    <main className="auth-screen">
      <section className="auth-card">
        <div className="brand-mark">IRPA</div>

        <h1>Digital Board Governance</h1>

        <p className="auth-subtitle">
          Secure governance workspace for IRPA members and administrators.
        </p>

        <form onSubmit={submit}>
          <label>Email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />

          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={6}
          />

          <button type="submit" disabled={busy}>
            {busy
              ? "Please wait..."
              : mode === "register"
                ? "Create Account"
                : "Sign In"}
          </button>
        </form>

        <button className="secondary-button" onClick={googleLogin}>
          Continue with Google
        </button>

        <button className="text-button" onClick={resetPassword}>
          Forgot password?
        </button>

        <button className="text-button" onClick={adminLink}>
          Administrator Gateway
        </button>

        <button
          className="text-button"
          onClick={() =>
            setMode(mode === "login" ? "register" : "login")
          }
        >
          {mode === "login"
            ? "Create a member account"
            : "Return to sign in"}
        </button>

        {message && <div className="auth-message">{message}</div>}
      </section>
    </main>
  );
}

function AppShell({ user }) {
  const [activeModule, setActiveModule] = useState("Dashboard");

  async function handleLogout() {
    await logout();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-mark">IRPA</div>
          <div>
            <strong>IRPA</strong>
            <span>Digital Governance</span>
          </div>
        </div>

        <nav>
          {modules.map((module) => (
            <button
              key={module}
              className={
                activeModule === module
                  ? "nav-item active"
                  : "nav-item"
              }
              onClick={() => setActiveModule(module)}
            >
              {module}
            </button>
          ))}
        </nav>

        <button className="logout-button" onClick={handleLogout}>
          Sign Out
        </button>
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
        {cards.map(([label, value]) => (
          <div className="stat-card" key={label}>
            <span>{label}</span>
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
      <h1>{name}</h1>
      <p>
        This module is connected to the IRPA governance workspace.
      </p>

      <div className="module-status">
        <strong>Module foundation ready</strong>
        <span>
          Functional workflow and Firebase data integration will be
          implemented here.
        </span>
      </div>
    </section>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);

  useEffect(() => {
    const unsubscribe = observeAuthState(async (currentUser) => {
      setUser(currentUser);
    });

    return () => unsubscribe();
  }, []);

  useEffect(() => {
    async function processMagicLink() {
      if (!isMagicLink()) return;

      const storedEmail = window.localStorage.getItem(
        "irpaEmailForSignIn"
      );

      if (!storedEmail) return;

      try {
        await completeMagicLink(storedEmail);
        window.localStorage.removeItem("irpaEmailForSignIn");
      } catch {
        // Authentication state will remain unchanged.
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

  return <AppShell user={user} />;
}
