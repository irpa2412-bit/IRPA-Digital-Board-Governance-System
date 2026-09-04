import React, { useEffect, useMemo, useState } from "react";
import {
  COLLECTIONS,
  createRecord,
  getRecords,
  updateRecord,
  deleteRecord
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
  const [editingId, setEditingId] = useState(null);

  const [showForm, setShowForm] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [statusFilter, setStatusFilter] = useState("All");

  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

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

  function openAddForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
    setError("");
    setSuccess("");
  }

  function openEditForm(member) {
    setEditingId(member.id);

    setForm({
      fullName: member.fullName || "",
      email: member.email || "",
      phone: member.phone || "",
      role: member.role || "Board Member",
      position: member.position || "",
      committee: member.committee || "",
      status: member.status || "Pending",
      notes: member.notes || ""
    });

    setShowForm(true);
    setError("");
    setSuccess("");
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function saveMember(event) {
    event.preventDefault();

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const memberData = {
        ...form,
        memberType: "Governance Member"
      };

      if (editingId) {
        await updateRecord(
          COLLECTIONS.members,
          editingId,
          memberData
        );

        setSuccess("Member profile updated successfully.");
      } else {
        await createRecord(
          COLLECTIONS.members,
          memberData
        );

        setSuccess("Member added successfully.");
      }

      closeForm();
      await loadMembers();
    } catch (err) {
      setError(
        err.message ||
          (editingId
            ? "Unable to update member."
            : "Unable to save member.")
      );
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(member, status) {
    setError("");
    setSuccess("");

    try {
      await updateRecord(
        COLLECTIONS.members,
        member.id,
        { status }
      );

      setSuccess(
        `${member.fullName} is now ${status}.`
      );

      await loadMembers();
    } catch (err) {
      setError(
        err.message || "Unable to update member status."
      );
    }
  }

  async function removeMember(member) {
    const confirmed = window.confirm(
      `Are you sure you want to delete ${member.fullName}? This action cannot be undone.`
    );

    if (!confirmed) {
      return;
    }

    setError("");
    setSuccess("");

    try {
      await deleteRecord(
        COLLECTIONS.members,
        member.id
      );

      setSuccess(
        `${member.fullName} has been removed.`
      );

      await loadMembers();
    } catch (err) {
      setError(
        err.message || "Unable to delete member."
      );
    }
  }

  const filteredMembers = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();

    return members.filter((member) => {
      const matchesSearch =
        !searchTerm ||
        [
          member.fullName,
          member.email,
          member.phone,
          member.role,
          member.position,
          member.committee
        ]
          .filter(Boolean)
          .some((value) =>
            String(value)
              .toLowerCase()
              .includes(searchTerm)
          );

      const matchesRole =
        roleFilter === "All" ||
        member.role === roleFilter;

      const matchesStatus =
        statusFilter === "All" ||
        member.status === statusFilter;

      return (
        matchesSearch &&
        matchesRole &&
        matchesStatus
      );
    });
  }, [
    members,
    search,
    roleFilter,
    statusFilter
  ]);

  const totalMembers = members.length;

  const activeMembers = members.filter(
    (member) => member.status === "Active"
  ).length;

  const pendingMembers = members.filter(
    (member) => member.status === "Pending"
  ).length;

  const suspendedMembers = members.filter(
    (member) => member.status === "Suspended"
  ).length;

  return (
    <section className="module-panel">

      <div className="module-header">
        <div>
          <h1>Members</h1>

          <p>
            Manage IRPA Board, committee and governance
            members.
          </p>
        </div>

        <button
          type="button"
          onClick={
            showForm ? closeForm : openAddForm
          }
        >
          {showForm ? "Close Form" : "Add Member"}
        </button>
      </div>

      {success && (
        <div className="success-message">
          {success}
        </div>
      )}

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <div className="member-summary">

        <div className="stat-card">
          <span>Total Members</span>
          <strong>{totalMembers}</strong>
        </div>

        <div className="stat-card">
          <span>Active</span>
          <strong>{activeMembers}</strong>
        </div>

        <div className="stat-card">
          <span>Pending</span>
          <strong>{pendingMembers}</strong>
        </div>

        <div className="stat-card">
          <span>Suspended</span>
          <strong>{suspendedMembers}</strong>
        </div>

      </div>

      {showForm && (
        <form
          className="record-form"
          onSubmit={saveMember}
        >

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
                <option
                  key={role}
                  value={role}
                >
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
                <option
                  key={status}
                  value={status}
                >
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
              rows="4"
            />
          </div>

          <div className="form-actions">

            <button
              type="submit"
              disabled={saving}
            >
              {saving
                ? "Saving..."
                : editingId
                ? "Update Member"
                : "Save Member"}
            </button>

            <button
              type="button"
              onClick={closeForm}
              disabled={saving}
            >
              Cancel
            </button>

          </div>

        </form>
      )}

      <div className="member-filters">

        <div className="form-field">
          <label>Search Members</label>

          <input
            type="search"
            value={search}
            onChange={(event) =>
              setSearch(event.target.value)
            }
            placeholder="Search name, email, role..."
          />
        </div>

        <div className="form-field">
          <label>Role</label>

          <select
            value={roleFilter}
            onChange={(event) =>
              setRoleFilter(event.target.value)
            }
          >
            <option value="All">All Roles</option>

            {ROLES.map((role) => (
              <option
                key={role}
                value={role}
              >
                {role}
              </option>
            ))}
          </select>
        </div>

        <div className="form-field">
          <label>Status</label>

          <select
            value={statusFilter}
            onChange={(event) =>
              setStatusFilter(event.target.value)
            }
          >
            <option value="All">All Statuses</option>

            {STATUSES.map((status) => (
              <option
                key={status}
                value={status}
              >
                {status}
              </option>
            ))}
          </select>
        </div>

      </div>

      <div className="records-table">

        {loading ? (
          <p>Loading members...</p>
        ) : filteredMembers.length === 0 ? (
          <p>
            {members.length === 0
              ? "No members have been registered yet."
              : "No members match the current filters."}
          </p>
        ) : (
          filteredMembers.map((member) => (

            <article
              className="record-row"
              key={member.id}
            >

              <div className="record-main">

                <strong>
                  {member.fullName}
                </strong>

                <div>
                  {member.email}
                </div>

                {member.phone && (
                  <div>
                    {member.phone}
                  </div>
                )}

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

                <div>
                  Status: {member.status}
                </div>

              </div>

              <div className="member-actions">

                <button
                  type="button"
                  onClick={() =>
                    openEditForm(member)
                  }
                >
                  Edit
                </button>

                {member.status !== "Active" && (
                  <button
                    type="button"
                    onClick={() =>
                      changeStatus(
                        member,
                        "Active"
                      )
                    }
                  >
                    Activate
                  </button>
                )}

                {member.status === "Active" && (
                  <button
                    type="button"
                    onClick={() =>
                      changeStatus(
                        member,
                        "Inactive"
                      )
                    }
                  >
                    Deactivate
                  </button>
                )}

                {member.status !== "Suspended" && (
                  <button
                    type="button"
                    onClick={() =>
                      changeStatus(
                        member,
                        "Suspended"
                      )
                    }
                  >
                    Suspend
                  </button>
                )}

                <button
                  type="button"
                  onClick={() =>
                    removeMember(member)
                  }
                >
                  Delete
                </button>

              </div>

            </article>

          ))
        )}

      </div>

    </section>
  );
}
