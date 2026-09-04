import React, { useEffect, useState } from "react";
import {
  createRecord,
  getRecords,
  updateRecord,
  COLLECTIONS
} from "../firebase/data";
import { sendAdminMagicLink } from "../firebase/auth";

export default function Invitations() {
  const [invitations, setInvitations] = useState([]);
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState("Board Member");
  const [memberType, setMemberType] = useState("Governance Member");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadInvitations() {
    try {
      const data = await getRecords(COLLECTIONS.invitations);
      setInvitations(data);
    } catch (err) {
      setError(err.message || "Unable to load invitations.");
    }
  }

  useEffect(() => {
    loadInvitations();
  }, []);

  async function createInvitation(event) {
    event.preventDefault();

    const cleanEmail = email.trim().toLowerCase();

    setBusy(true);
    setError("");
    setMessage("");

    try {
      await createRecord(COLLECTIONS.invitations, {
        email: cleanEmail,
        name: name.trim(),
        role,
        memberType,
        status: "Pending"
      });

      await sendAdminMagicLink(cleanEmail);

      setEmail("");
      setName("");
      setRole("Board Member");
      setMemberType("Governance Member");

      await loadInvitations();

      setMessage(
        `Invitation created for ${cleanEmail}.`
      );
    } catch (err) {
      setError(
        err.message || "Unable to create the invitation."
      );
    } finally {
      setBusy(false);
    }
  }

  async function cancelInvitation(invitation) {
    setBusy(true);
    setError("");
    setMessage("");

    try {
      await updateRecord(
        COLLECTIONS.invitations,
        invitation.id,
        {
          status: "Cancelled"
        }
      );

      await loadInvitations();

      setMessage("Invitation cancelled.");
    } catch (err) {
      setError(
        err.message || "Unable to cancel invitation."
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h1>Member Invitations</h1>
          <p>
            Securely invite authorised IRPA governance members.
          </p>
        </div>
      </div>

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

      <div className="panel">
        <h2>Create Invitation</h2>

        <form onSubmit={createInvitation}>
          <div className="form-grid">

            <div className="form-field">
              <label>Member Name</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                required
              />
            </div>

            <div className="form-field">
              <label>Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="member@example.org"
                required
              />
            </div>

            <div className="form-field">
              <label>Governance Role</label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option>Board Member</option>
                <option>Board Chairperson</option>
                <option>Board Secretary</option>
                <option>Executive Director</option>
                <option>Observer</option>
              </select>
            </div>

            <div className="form-field">
              <label>Member Type</label>
              <select
                value={memberType}
                onChange={(e) =>
                  setMemberType(e.target.value)
                }
              >
                <option>Governance Member</option>
                <option>Management</option>
                <option>Technical Advisor</option>
                <option>Observer</option>
              </select>
            </div>

          </div>

          <button type="submit" disabled={busy}>
            {busy
              ? "Creating Invitation..."
              : "Create Member Invitation"}
          </button>
        </form>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h2>Invitation Register</h2>
          <span>
            {invitations.length} invitation(s)
          </span>
        </div>

        <div className="table-wrapper">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Role</th>
                <th>Type</th>
                <th>Status</th>
                <th>Action</th>
              </tr>
            </thead>

            <tbody>
              {invitations.length === 0 ? (
                <tr>
                  <td colSpan="6">
                    No invitations found.
                  </td>
                </tr>
              ) : (
                invitations.map((invitation) => (
                  <tr key={invitation.id}>
                    <td>{invitation.name || "—"}</td>
                    <td>{invitation.email}</td>
                    <td>{invitation.role}</td>
                    <td>{invitation.memberType}</td>
                    <td>
                      <span className="status-badge">
                        {invitation.status}
                      </span>
                    </td>
                    <td>
                      {invitation.status === "Pending" && (
                        <button
                          type="button"
                          onClick={() =>
                            cancelInvitation(invitation)
                          }
                          disabled={busy}
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
