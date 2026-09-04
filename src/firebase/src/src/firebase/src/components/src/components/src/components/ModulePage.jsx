import React, { useEffect, useState } from "react";
import {
  COLLECTIONS,
  createRecord,
  deleteRecord,
  getRecords
} from "../firebase/data";

export default function ModulePage({ title, collectionName, fields = [] }) {
  const [records, setRecords] = useState([]);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadRecords() {
    setLoading(true);
    setError("");

    try {
      const data = await getRecords(collectionName);
      setRecords(data);
    } catch (err) {
      setError(err.message || "Unable to load records.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadRecords();
  }, [collectionName]);

  function updateField(name, value) {
    setForm((current) => ({
      ...current,
      [name]: value
    }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      await createRecord(collectionName, form);
      setForm({});
      await loadRecords();
    } catch (err) {
      setError(err.message || "Unable to save record.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id) {
    if (!window.confirm("Delete this record?")) return;

    try {
      await deleteRecord(collectionName, id);
      await loadRecords();
    } catch (err) {
      setError(err.message || "Unable to delete record.");
    }
  }

  return (
    <section className="module-panel">
      <div className="module-header">
        <div>
          <h1>{title}</h1>
          <p>IRPA Governance Workspace</p>
        </div>

        <span className="record-count">
          {records.length} records
        </span>
      </div>

      {error && (
        <div className="error-message">
          {error}
        </div>
      )}

      <form className="record-form" onSubmit={handleSubmit}>
        {fields.map((field) => (
          <div className="form-field" key={field.name}>
            <label>{field.label}</label>

            {field.type === "textarea" ? (
              <textarea
                value={form[field.name] || ""}
                onChange={(e) =>
                  updateField(field.name, e.target.value)
                }
                required={field.required}
              />
            ) : (
              <input
                type={field.type || "text"}
                value={form[field.name] || ""}
                onChange={(e) =>
                  updateField(field.name, e.target.value)
                }
                required={field.required}
              />
            )}
          </div>
        ))}

        <button type="submit" disabled={saving}>
          {saving ? "Saving..." : "Add Record"}
        </button>
      </form>

      <div className="records-table">
        {loading ? (
          <p>Loading records...</p>
        ) : records.length === 0 ? (
          <p>No records available.</p>
        ) : (
          records.map((record) => (
            <article className="record-row" key={record.id}>
              <div>
                {fields.map((field) => (
                  <div key={field.name}>
                    <strong>{field.label}:</strong>{" "}
                    {String(record[field.name] ?? "")}
                  </div>
                ))}
              </div>

              <button
                className="danger-button"
                onClick={() => handleDelete(record.id)}
              >
                Delete
              </button>
            </article>
          ))
        )}
      </div>
    </section>
  );
}
