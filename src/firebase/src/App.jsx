import React, { useEffect, useState } from "react";
import Members from "./pages/Members";
import AdminGateway from "./pages/AdminGateway";

import {
  observeAuthState,
  logout
} from "./firebase/auth";

import { getAdminProfile } from "./firebase/data";

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
    items: [
      "Finance Portfolio"
    ]
  },
  {
    title: "Evidence",
    items: [
      "Reports",
      "Audit Trail"
    ]
  },
  {
    title: "System",
    items: [
      "Settings"
    ]
  }
];

export default function App() {
  const [user, setUser] = useState(null);
  const [adminProfile, setAdminProfile] =
    useState(null);

  const [authLoading, setAuthLoading] =
    useState(true);

  const [profileLoading, setProfileLoading] =
    useState(false);

  const [activeModule, setActiveModule] =
    useState("Dashboard");

  const [error, setError] =
    useState("");

  useEffect(() => {
    const unsubscribe =
      observeAuthState(async (currentUser) => {
        setUser(currentUser);
        setAdminProfile(null);
        setError("");

        if (!currentUser) {
          setAuthLoading(false);
          setProfileLoading(false);
          return;
        }

        setProfileLoading(true);

        try {
          const profile =
            await getAdminProfile(
              currentUser.uid
            );

          setAdminProfile(profile);

          if (!profile?.active) {
            setError(
              "This account is authenticated but is not authorised as an active IRPA administrator."
            );
          }
        } catch (err) {
          setAdminProfile(null);

          setError(
            err.message ||
              "Unable to verify administrator access."
          );
        } finally {
          setProfileLoading(false);
          setAuthLoading(false);
        }
      });

    return unsubscribe;
  }, []);

  async function handleLogout() {
    try {
      await logout();

      setUser(null);
      setAdminProfile(null);
      setActiveModule("Dashboard");
      setError("");
    } catch (err) {
      setError(
        err.message ||
          "Unable to sign out."
      );
    }
  }

  /*
   * Initial loading
   */
  if (authLoading) {
    return (
      <div className="app-shell">
        <div className="loading-screen">
          Loading IRPA Digital Board Governance System...
        </div>
      </div>
    );
  }

  /*
   * Administrator Gateway
   *
   * All unauthenticated users enter through
   * the dedicated administrator gateway.
   */
  if (!user) {
    return (
      <div className="app-shell">
        <AdminGateway />
      </div>
    );
  }

  /*
   * Firebase authentication completed.
   * Now verify the administrator profile.
   */
  if (profileLoading) {
    return (
      <div className="app-shell">
        <div className="loading-screen">
          Verifying IRPA administrator access...
        </div>
      </div>
    );
  }

  /*
   * Authentication does NOT equal authorisation.
   *
   * The user must have:
   * adminProfiles/{uid}
   * active === true
   */
  if (!adminProfile?.active) {
    return (
      <div className="app-shell">
        <div className="auth-card">

          <div className="brand-block">
            <h1>IRPA</h1>

            <p>
              Digital Board Governance System
            </p>
          </div>

          <h2>
            Access Not Authorised
          </h2>

          {error && (
            <div className="error-message">
              {error}
            </div>
          )}

          <p>
            The Firebase account has been
            authenticated, but no active IRPA
            administrator profile is associated
            with this account.
          </p>

          <div className="form-field">
            <label>
              Authenticated Account
            </label>

            <input
              value={
                user.email || "Unknown account"
              }
              readOnly
            />
          </div>

          <button
            type="button"
            onClick={handleLogout}
          >
            Sign Out
          </button>

        </div>
      </div>
    );
  }

  /*
   * Authorised administrator workspace
   */
  return (
    <div className="app-shell">

      <aside className="sidebar">

        <div className="sidebar-brand">
          <h1>IRPA</h1>

          <p>
            Digital Board Governance
          </p>
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
                  onClick={() => {
                    setActiveModule(item);
                    setError("");
                  }}
                >
                  {item}
                </button>
              ))}

            </div>
          ))}

        </nav>

        <div className="sidebar-footer">

          <div className="sidebar-user">

            <strong>
              {adminProfile?.role ||
                "Administrator"}
            </strong>

            <span>
              {user.email}
            </span>

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
            <h2>
              {activeModule}
            </h2>

            <p>
              IRPA Digital Board Governance Workspace
            </p>
          </div>

          <div className="user-info">

            <span>
              {adminProfile?.role ||
                "Administrator"}
            </span>

            <span>
              {user.email}
            </span>

          </div>

        </header>

        <main className="content-area">

          {activeModule === "Dashboard" && (
            <Dashboard
              adminProfile={adminProfile}
            />
          )}

          {activeModule === "Members" && (
            <Members />
          )}

          {activeModule !== "Dashboard" &&
            activeModule !== "Members" && (
              <ModulePlaceholder
                name={activeModule}
              />
            )}

        </main>

      </section>

    </div>
  );
}


/*
 * Governance Dashboard
 */
function Dashboard({
  adminProfile
}) {
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
          Central workspace for IRPA Board
          and governance activities.
        </p>

        <small>
          Administrator:
          {" "}
          {adminProfile?.role ||
            "Administrator"}
        </small>

      </div>

      <div className="dashboard-grid">

        {cards.map(
          ([title, value]) => (
            <div
              className="stat-card"
              key={title}
            >

              <span>
                {title}
              </span>

              <strong>
                {value}
              </strong>

            </div>
          )
        )}

      </div>

    </div>
  );
}


/*
 * Temporary module shell.
 *
 * Individual governance modules will be
 * implemented without removing the navigation.
 */
function ModulePlaceholder({
  name
}) {
  return (
    <section className="module-panel">

      <div className="module-header">

        <div>

          <h1>
            {name}
          </h1>

          <p>
            This governance module is ready
            for implementation.
          </p>

        </div>

      </div>

    </section>
  );
}
