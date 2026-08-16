// src/modal/InterlockModal.jsx
import { useState, useEffect } from "react";
import { API } from "../service/api";
import { ModalBackdrop, ModalPanel } from "../components/motion";

// ── Icons used only in this modal ─────────────────────────────
const IconX = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const IconCheck = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const IconDB = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v14" />
    <path d="M20 5v14" />
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    <path d="M4 19c0 1.7 3.6 3 8 3s8-1.3 8-3" />
  </svg>
);

// ── Main Component ─────────────────────────────────────────────
export default function InterlockModal({ onClose, onSaved }) {
  const [sections, setSections] = useState(null);
  const [entries, setEntries] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    fetch(`${API}/api/interlock`)
      .then((r) => r.json())
      .then((data) => {
        setSections(data);
        setEntries(JSON.parse(JSON.stringify(data)));
      })
      .catch(() => setSections({}));
  }, []);

  const handleChange = (section, key, val) => {
    setEntries((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: val },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/interlock`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: entries }),
      });
      const d = await r.json();
      if (d.success) {
        setSections(JSON.parse(JSON.stringify(entries)));
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        if (onSaved) onSaved(d.db_connected);
      }
    } catch (e) {
      console.error("Save error:", e);
    }
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(`${API}/api/test-connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(entries),
      });
      const d = await r.json();
      setTestResult(d);
      setTimeout(() => setTestResult(null), 5000);
    } catch {
      setTestResult({ success: false, message: "Cannot reach backend" });
    }
    setTesting(false);
  };

  return (
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <ModalPanel className="bg-[var(--bg-surface)] border border-[var(--border-soft)] rounded-2xl w-[560px] max-h-[82vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-soft)]">
          <div>
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest font-mono mb-0.5">Configuration</p>
            <h2 className="text-[var(--text-primary)] font-semibold text-base">Interlock Settings</h2>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"
          >
            <IconX />
          </button>
        </div>

        {/* Body */}
        <div className="overflow-y-auto flex-1 px-6 py-4 space-y-6">
          {!sections ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            Object.entries(sections).map(([section, fields]) => (
              <div key={section}>
                <p className="text-xs font-mono text-[#22C55E] uppercase tracking-widest mb-3">{section}</p>
                <div className="bg-[var(--bg-surface-2)] rounded-xl border border-[var(--border-soft)] overflow-hidden">
                  {Object.entries(fields).map(([key, val], i, arr) => (
                    <div
                      key={key}
                      className={`flex items-center gap-4 px-4 py-3 ${
                        i < arr.length - 1 ? "border-b border-[var(--border-soft)]" : ""
                      }`}
                    >
                      <span className="text-[var(--text-secondary)] text-sm w-44 shrink-0">{key}</span>
                      {key === "Interlock ByPass" ? (
                        <select
                          value={entries[section]?.[key] ?? val}
                          onChange={(e) => handleChange(section, key, e.target.value)}
                          className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#22C55E] transition-colors"
                        >
                          <option>Yes</option>
                          <option>No</option>
                        </select>
                      ) : (
                        <input
                          type={key.toLowerCase().includes("password") ? "password" : "text"}
                          value={entries[section]?.[key] ?? val}
                          onChange={(e) => handleChange(section, key, e.target.value)}
                          className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#22C55E] transition-colors"
                        />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-6 py-4 border-t border-[var(--border-soft)]">
          {testResult && (
            <div
              className={`flex items-center gap-2 rounded-lg px-3 py-2 text-xs ${
                testResult.success
                  ? "bg-[#22C55E]/10 border border-[#22C55E]/30 text-[#22C55E]"
                  : "bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#FCA5A5]"
              }`}
            >
              <span>{testResult.success ? "✓" : "✗"}</span>
              <span className="font-mono">{testResult.message}</span>
            </div>
          )}
          <div className="flex items-center justify-between">
            <p
              className={`text-sm transition-all duration-300 flex items-center gap-1.5 ${
                saved ? "text-[#22C55E] opacity-100" : "opacity-0"
              }`}
            >
              <IconCheck /> Saved successfully
            </p>
            <div className="flex gap-2">
              <button
                onClick={handleTest}
                disabled={testing}
                className="px-4 py-2 text-xs font-semibold border border-[var(--border)] hover:border-[#22C55E]/50 text-[var(--text-secondary)] hover:text-[#22C55E] rounded-lg transition-colors disabled:opacity-60 flex items-center gap-1.5"
              >
                {testing ? (
                  <div className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <IconDB />
                )}
                {testing ? "Testing…" : "Test Connection"}
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--text-muted)] rounded-lg transition-colors"
              >
                Close
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-sm font-semibold bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {saving && (
                  <div className="w-4 h-4 border-2 border-[#052E16] border-t-transparent rounded-full animate-spin" />
                )}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}