import React, { useEffect, useState } from "react";
import {
  COLLECTIONS,
  createRecord,
  getRecords,
  updateRecord
} from "../firebase/data";

const ROLES = [
  "Board Chairperson",
  "Board Member",
  "Committee Chairperson",
  "Committee Member",
  "Executive Director",
  "Administrator",
  "Secretariat"
];

const STATUSES = [
  "Pending",
  "Active",
  "Suspended",
  "Inactive"
];

const EMPTY_FORM = {
  fullName: "",
  email: "",
  phone: "",
  role: "Board Member",
  position: "",
  committee: "",
  status: "Pending",
  notes: ""
};

export default function Members() {
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadMembers() {
    setLoading(true);
    setError("");

    try {
      const records = await getRecords(COLLECTIONS.members);
      setMembers(records);
    } catch (err) {
      setError(err.message || "Unable to load members.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadMembers();
  }, []);

  function changeField(event) {
    const { name, value } = event.target;

    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function saveMember(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await createRecord(COLLECTIONS.members, {
        ...form,
        memberType: "Governance Member"
      });

      setForm(EMPTY_FORM);
      setShowForm(false);
      await loadMembers();
    } catch (err) {
      setError(err.message || "Unable to save member.");
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(member, status) {
    setError("");

    try {
      await updateRecord(COLLECTIONS.members, member.id, {
        status
      });

      await loadMembers();
    } catch (err) {
      setError(err.message || "Unable to update member.");
    }
  }

  return (
    <section className="module-panel">
      <div className="module-header">
        <div>
          <h1>Members</h1>
          <p>
            Manage IRPA Board, committee and governance members.
          </p>
        </div>

        <button
          type="button"
          onClick={() => setShowForm((current) => !current)}
        >
          {showForm ? "Close Form" : "Add Member"}
        </button>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      {showForm && (
        <form className="record-form" onSubmit={saveMember}>
          <div className="form-field">
            <label>Full Name</label>
            <input
              name="fullName"
              value={form.fullName}
              onChange={changeField}
              required
            />
          </div>

          <div className="form-field">
            <label>Email Address</label>
            <input
              type="email"
              name="email"
              value={form.email}
              onChange={changeField}
              required
            />
          </div>

          <div className="form-field">
            <label>Phone</label>
            <input
              name="phone"
              value={form.phone}
              onChange={changeField}
            />
          </div>

          <div className="form-field">
            <label>Governance Role</label>
            <select
              name="role"
              value={form.role}
              onChange={changeField}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label>Position</label>
            <input
              name="position"
              value={form.position}
              onChange={changeField}
              placeholder="e.g. Director / Chairperson"
            />
          </div>

          <div className="form-field">
            <label>Committee</label>
            <input
              name="committee"
              value={form.committee}
              onChange={changeField}
              placeholder="Optional"
            />
          </div>

          <div className="form-field">
            <label>Status</label>
            <select
              name="status"
              value={form.status}
              onChange={changeField}
            >
              {STATUSES.map((status) => (
                <option key={status} value={status}>
                  {status}
                </option>
              ))}
            </select>
          </div>

          <div className="form-field">
            <label>Notes</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={changeField}
            />
          </div>

          <button type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save Member"}
          </button>
        </form>
      )}

      <div className="member-summary">
        <div className="stat-card">
          <span>Total Members</span>
          <strong>{members.length}</strong>
        </div>

        <div className="stat-card">
          <span>Active</span>
          <strong>
            {members.filter((m) => m.status === "Active").length}
          </strong>
        </div>

        <div className="stat-card">
          <span>Pending</span>
          <strong>
            {members.filter((m) => m.status === "Pending").length}
          </strong>
        </div>
      </div>

      <div className="records-table">
        {loading ? (
          <p>Loading members...</p>
        ) : members.length === 0 ? (
          <p>No members have been registered yet.</p>
        ) : (
          members.map((member) => (
            <article className="record-row" key={member.id}>
              <div>
                <strong>{member.fullName}</strong>
                <div>{member.email}</div>
                <div>
                  {member.role}
                  {member.position
                    ? ` · ${member.position}`
                    : ""}
                </div>

                {member.committee && (
                  <div>
                    Committee: {member.committee}
                  </div>
                )}

                <div>Status: {member.status}</div>
              </div>

              <div className="member-actions">
                {member.status !== "Active" && (
                  <button
                    type="button"
                    onClick={() =>
                      changeStatus(member, "Active")
                    }
                  >
                    Activate
                  </button>
                )}

                {member.status === "Active" && (
                  <button
                    type="button"
                    onClick={() =>
                      changeStatus(member, "Inactive")
                    }
                  >
                    Deactivate
                  </button>
                )}
              </div>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
