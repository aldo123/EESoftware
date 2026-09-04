// src/modal/InternalVariable.jsx
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ModalBackdrop, ModalPanel } from "../components/motion";
import { API } from "../service/api";

const EMPTY_FORM = { name: "", data_type: "string", value: "" };

export default function InternalVariable({ onClose, cpNumber }) {
  const [variables, setVariables] = useState([]);
  const currentCP = String(cpNumber ?? "").trim();
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadVariables = async () => {
    setLoading(true);
    setError("");

    try {
      if (!currentCP) {
        throw new Error("CP number is required to open Internal Variables.");
      }

      const res = await fetch(
        `${API}/api/internal-variables?cp_number=${encodeURIComponent(currentCP)}`
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.message || "Failed to load internal variables"
        );
      }

      setVariables(Array.isArray(data.variables) ? data.variables : []);
    } catch (err) {
      setError(err.message || "Failed to load internal variables");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadVariables();
  }, [currentCP]);

  const resetForm = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormOpen(false);
    setError("");
  };

  const startAdd = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setFormOpen(true);
    setError("");
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setFormOpen(true);

    setForm({
      name: item.name || "",
      data_type: item.data_type || "string",
      value:
        item.data_type === "boolean"
          ? item.value
            ? "true"
            : "false"
          : String(item.value ?? ""),
    });

    setError("");
  };

  const save = async () => {
    const name = String(form.name || "").trim();

    if (!name) {
      setError("Variable name is required.");
      return;
    }

    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      setError(
        "Name must start with a letter/underscore and contain only letters, numbers, or underscore."
      );
      return;
    }

    if (form.data_type === "number") {
      const numericValue = Number(form.value);

      if (!Number.isFinite(numericValue)) {
        setError("Number value is invalid.");
        return;
      }
    }

    setSaving(true);
    setError("");

    try {
      const editing = editingId !== null;

      const url = editing
        ? `${API}/api/internal-variables/${editingId}`
        : `${API}/api/internal-variables`;

      const method = editing ? "PUT" : "POST";

      const payload = {
        name,
        cp_number: currentCP,
        data_type: form.data_type,
        value: form.value,
      };

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        const message = data.message || "Failed to save variable";

        // The backend currently treats variable names as globally unique.
        // If the requested name already exists, look up its owner CP so the
        // user gets a useful message instead of only "already exists".
        if (
          res.status === 409 ||
          /already exists/i.test(String(message))
        ) {
          try {
            const lookupRes = await fetch(`${API}/api/internal-variables`);
            const lookupData = await lookupRes.json();

            const allVariables = Array.isArray(lookupData.variables)
              ? lookupData.variables
              : [];

            const existing = allVariables.find(
              (item) =>
                String(item.name || "").trim().toLowerCase() ===
                name.toLowerCase()
            );

            if (existing) {
              const ownerCP = String(existing.cp_number ?? "").trim();

              if (ownerCP) {
                throw new Error(
                  `Variable '${name}' already exists and is used by CP ${ownerCP}.`
                );
              }

              throw new Error(
                `Variable '${name}' already exists, but its CP information is not available.`
              );
            }
          } catch (lookupErr) {
            // If lookupErr is our useful duplicate message, preserve it.
            if (
              lookupErr?.message &&
              /already exists/i.test(lookupErr.message)
            ) {
              throw lookupErr;
            }
          }
        }

        throw new Error(message);
      }

      await loadVariables();
      resetForm();
    } catch (err) {
      setError(err.message || "Failed to save variable");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item) => {
    if (
      !window.confirm(
        `Delete internal variable '${item.name}'?`
      )
    ) {
      return;
    }

    try {
      const res = await fetch(
        `${API}/api/internal-variables/${item.id}`,
        {
          method: "DELETE",
        }
      );

      const data = await res.json();

      if (!res.ok) {
        throw new Error(
          data.message || "Failed to delete variable"
        );
      }

      if (editingId === item.id) {
        resetForm();
      }

      await loadVariables();
    } catch (err) {
      setError(err.message || "Failed to delete variable");
    }
  };

  const displayValue = (item) => {
    if (item.data_type === "boolean") {
      return item.value ? "TRUE" : "FALSE";
    }

    return String(item.value ?? "");
  };

  return (
    <ModalBackdrop className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <ModalPanel
        className="w-[min(920px,96vw)] max-h-[90vh] rounded-2xl border border-[#22C55E]/40 overflow-hidden shadow-2xl flex flex-col"
        style={{ background: "var(--bg-surface-2)" }}
      >
        <div className="px-6 py-4 border-b border-[var(--border-soft)] flex items-center justify-between shrink-0">
          <div>
            <p className="text-[#22C55E] font-bold text-lg">
              Internal Variables {currentCP ? `— CP ${currentCP}` : ""}
            </p>
            <p className="text-[var(--text-muted)] text-xs mt-0.5">
              Variables belonging to this CP, stored in
              backend/data/internalvariable.db
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg text-[var(--text-secondary)] hover:text-white hover:bg-[#DC2626] transition-colors"
          >
            ✕
          </button>
        </div>

        <div className="p-6 overflow-auto flex-1">
          <div className="rounded-xl border border-[var(--border)] overflow-hidden">
            <div className="px-4 py-3 bg-[var(--bg-elevated)] border-b border-[var(--border)] flex items-center justify-between">
              <p className="text-[var(--text-primary)] text-xs font-bold uppercase tracking-wider">
                Variable List
              </p>

              <button
                onClick={startAdd}
                className="px-3 py-1.5 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] text-xs font-bold transition-colors"
              >
                + Add Variable
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-2.5 font-semibold">
                      Name
                    </th>
                    <th className="px-4 py-2.5 font-semibold">
                      CP
                    </th>
                    <th className="px-4 py-2.5 font-semibold">
                      Type
                    </th>
                    <th className="px-4 py-2.5 font-semibold">
                      Value
                    </th>
                    <th className="px-4 py-2.5 font-semibold text-right">
                      Action
                    </th>
                  </tr>
                </thead>

                <tbody>
                  {loading && (
                    <tr>
                      <td
                        colSpan="5"
                        className="px-4 py-8 text-center text-[var(--text-muted)]"
                      >
                        Loading…
                      </td>
                    </tr>
                  )}

                  {!loading && variables.length === 0 && (
                    <tr>
                      <td
                        colSpan="5"
                        className="px-4 py-8 text-center text-[var(--text-muted)]"
                      >
                        No internal variables.
                      </td>
                    </tr>
                  )}

                  {!loading &&
                    variables.map((item) => (
                      <tr
                        key={item.id}
                        className="border-t border-[var(--border-soft)] hover:bg-[var(--bg-elevated)]/60"
                      >
                        <td className="px-4 py-3 text-[#22C55E] font-mono font-semibold">
                          {item.name}
                        </td>

                        <td className="px-4 py-3 text-[#22C55E] font-semibold">
                          {item.cp_number || currentCP}
                        </td>
                        <td className="px-4 py-3 text-[var(--text-secondary)] uppercase">
                          {item.data_type}
                        </td>

                        <td className="px-4 py-3 text-[var(--text-primary)] font-mono">
                          {displayValue(item)}
                        </td>

                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => startEdit(item)}
                            className="px-2.5 py-1 rounded-md border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[#2563EB] hover:text-white mr-2"
                          >
                            Edit
                          </button>

                          <button
                            onClick={() => remove(item)}
                            className="px-2.5 py-1 rounded-md border border-[#EF4444]/40 text-[#FCA5A5] hover:bg-[#DC2626] hover:text-white"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>

          <AnimatePresence initial={false}>
            {formOpen && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-5 overflow-hidden"
              >
                <div className="rounded-xl border border-[#22C55E]/30 bg-[var(--bg-elevated)] p-4">
                  <div className="flex items-center justify-between mb-4">
                    <p className="text-[#22C55E] text-sm font-bold">
                      {editingId !== null
                        ? "Edit Variable"
                        : "Add Variable"}
                    </p>

                    <button
                      onClick={resetForm}
                      className="text-[var(--text-muted)] hover:text-white text-xs"
                    >
                      Cancel
                    </button>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <label className="block">
                      <span className="block text-[var(--text-muted)] text-[10px] uppercase mb-1">
                        Name
                      </span>

                      <input
                        value={form.name}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            name: e.target.value,
                          }))
                        }
                        placeholder="Temperature"
                        className="w-full h-10 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] px-3 text-sm font-mono outline-none focus:border-[#22C55E]"
                      />
                    </label>

                    <label className="block">
                      <span className="block text-[var(--text-muted)] text-[10px] uppercase mb-1">
                        Type
                      </span>

                      <select
                        value={form.data_type}
                        onChange={(e) =>
                          setForm((p) => ({
                            ...p,
                            data_type: e.target.value,
                            value:
                              e.target.value === "boolean"
                                ? "false"
                                : p.value,
                          }))
                        }
                        className="w-full h-10 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] px-3 text-sm outline-none focus:border-[#22C55E]"
                      >
                        <option value="string">
                          String
                        </option>
                        <option value="number">
                          Number
                        </option>
                        <option value="boolean">
                          Boolean
                        </option>
                      </select>
                    </label>

                    <label className="block">
                      <span className="block text-[var(--text-muted)] text-[10px] uppercase mb-1">
                        Value
                      </span>

                      {form.data_type === "boolean" ? (
                        <select
                          value={
                            form.value === "true"
                              ? "true"
                              : "false"
                          }
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              value: e.target.value,
                            }))
                          }
                          className="w-full h-10 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] px-3 text-sm outline-none focus:border-[#22C55E]"
                        >
                          <option value="false">
                            FALSE
                          </option>
                          <option value="true">
                            TRUE
                          </option>
                        </select>
                      ) : (
                        <input
                          type={
                            form.data_type === "number"
                              ? "number"
                              : "text"
                          }
                          step="any"
                          value={form.value}
                          onChange={(e) =>
                            setForm((p) => ({
                              ...p,
                              value: e.target.value,
                            }))
                          }
                          placeholder={
                            form.data_type === "number"
                              ? "0"
                              : "Value"
                          }
                          className="w-full h-10 rounded-lg bg-[var(--bg-input)] border border-[var(--border)] text-[var(--text-primary)] px-3 text-sm font-mono outline-none focus:border-[#22C55E]"
                        />
                      )}
                    </label>
                  </div>

                  {error && (
                    <p className="mt-3 text-[#FCA5A5] text-xs">
                      {error}
                    </p>
                  )}

                  <div className="mt-4 flex justify-end">
                    <button
                      onClick={save}
                      disabled={saving}
                      className="px-5 py-2 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-xs disabled:opacity-50"
                    >
                      {saving
                        ? "Saving…"
                        : editingId !== null
                        ? "Save Changes"
                        : "Create Variable"}
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {error && !formOpen && (
            <p className="mt-3 text-[#FCA5A5] text-xs">
              {error}
            </p>
          )}
        </div>

        <div className="px-6 py-4 border-t border-[var(--border-soft)] flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] text-sm"
          >
            Close
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}