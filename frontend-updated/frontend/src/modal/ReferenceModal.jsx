// src/modal/ReferenceModal.jsx
import { useState, useEffect, useCallback, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { API } from "../service/api";
import { ModalBackdrop, ModalPanel, dropdownVariants } from "../components/motion";

// ── Palette ────────────────────────────────────────────────────
// BG=#0F172A  CARD=#1E293B  HDR=#111827  INPUT=#172132
// TEXT=#E2E8F0  TEXT2=#94A3B8  SUCCESS=#22C55E  BLUE=#3B82F6  BORDER=#334155

// ── Icons ──────────────────────────────────────────────────────
const IconSearch  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>;
const IconPlus    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>;
const IconTrash   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>;
const IconEdit    = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>;
const IconDownload= () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>;
const IconColumns = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="18"/><rect x="14" y="3" width="7" height="18"/></svg>;
const IconSort    = ({ dir }) => <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">{dir === "asc" ? <polyline points="18 15 12 9 6 15"/> : <polyline points="6 9 12 15 18 9"/>}</svg>;
const IconGrip    = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="5" r="1" fill="currentColor"/><circle cx="9" cy="12" r="1" fill="currentColor"/><circle cx="9" cy="19" r="1" fill="currentColor"/><circle cx="15" cy="5" r="1" fill="currentColor"/><circle cx="15" cy="12" r="1" fill="currentColor"/><circle cx="15" cy="19" r="1" fill="currentColor"/></svg>;
const IconX       = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IconRefresh = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/><path d="M3.51 15A9 9 0 0 0 18.36 18.36L23 14"/></svg>;

// ── Input component ──────────────────────────────────────────
function Input({ value, onChange, placeholder, type = "text", className = "", ...rest }) {
  return (
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`bg-[var(--bg-surface)] border border-[var(--border)] focus:border-[#22C55E]/60 text-[var(--text-primary)] text-xs rounded-lg px-3 h-8 outline-none transition-colors placeholder-[var(--text-faint)] ${className}`}
      {...rest}
    />
  );
}

// ── Column Manager Modal ──────────────────────────────────────
function ColumnManagerModal({ columns, onSave, onClose }) {
  const [cols, setCols] = useState(columns.map(c => ({ ...c })));
  const [newKey, setNewKey] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const dragIdx = useRef(null);

  const addCol = () => {
    const k = newKey.trim().replace(/\s+/g, "_").toLowerCase();
    if (!k || !newLabel.trim()) return;
    if (cols.find(c => c.key === k)) return;
    setCols(p => [...p, { key: k, label: newLabel.trim(), width: 140 }]);
    setNewKey(""); setNewLabel("");
  };

  const removeCol = (idx) => setCols(p => p.filter((_, i) => i !== idx));
  const updateLabel = (idx, val) => setCols(p => p.map((c, i) => i === idx ? { ...c, label: val } : c));

  const onDragStart = (idx) => { dragIdx.current = idx; };
  const onDragOver  = (e, idx) => {
    e.preventDefault();
    if (dragIdx.current === null || dragIdx.current === idx) return;
    setCols(p => {
      const arr = [...p];
      const [moved] = arr.splice(dragIdx.current, 1);
      arr.splice(idx, 0, moved);
      dragIdx.current = idx;
      return arr;
    });
  };
  const onDragEnd = () => { dragIdx.current = null; };

  return (
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <ModalPanel className="w-[520px] max-h-[80vh] flex flex-col rounded-2xl overflow-hidden border border-[var(--border)] shadow-2xl" style={{ background: "var(--bg-surface-2)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)]">
          <div className="flex items-center gap-2">
            <span className="text-[#22C55E]"><IconColumns /></span>
            <span className="text-[var(--text-primary)] font-bold text-sm">Manage Columns</span>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"><IconX /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 flex flex-col gap-2">
          {cols.map((col, idx) => (
            <div
              key={col.key}
              draggable
              onDragStart={() => onDragStart(idx)}
              onDragOver={(e) => onDragOver(e, idx)}
              onDragEnd={onDragEnd}
              className="flex items-center gap-2 bg-[var(--bg-surface)] border border-[var(--border-soft)] rounded-xl px-3 py-2 cursor-grab active:cursor-grabbing group"
            >
              <span className="text-[var(--text-faint)] group-hover:text-[var(--text-muted)] transition-colors shrink-0"><IconGrip /></span>
              <span className="text-[var(--text-muted)] text-[10px] font-mono w-[110px] truncate shrink-0">{col.key}</span>
              <input
                value={col.label}
                onChange={e => updateLabel(idx, e.target.value)}
                className="flex-1 bg-transparent text-[var(--text-primary)] text-xs outline-none border-b border-transparent focus:border-[#22C55E]/50 transition-colors"
              />
              <button
                onClick={() => removeCol(idx)}
                className="shrink-0 w-6 h-6 rounded-lg flex items-center justify-center text-[var(--text-faint)] hover:text-[#EF4444] hover:bg-[#7F1D1D]/20 transition-colors"
              >
                <IconX />
              </button>
            </div>
          ))}
          {cols.length === 0 && (
            <p className="text-[var(--text-faint)] text-xs text-center py-4">No columns. Add one below.</p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-[var(--border-soft)]" style={{ background: "var(--bg-elevated)" }}>
          <p className="text-[var(--text-secondary)] text-[10px] font-bold uppercase tracking-wider mb-2">Add New Column</p>
          <div className="flex gap-2">
            <Input value={newKey} onChange={e => setNewKey(e.target.value)} placeholder="field_key" className="w-[130px]" onKeyDown={e => e.key === "Enter" && addCol()} />
            <Input value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Display Label" className="flex-1" onKeyDown={e => e.key === "Enter" && addCol()} />
            <button onClick={addCol} className="h-8 px-3 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-xs transition-colors flex items-center gap-1">
              <IconPlus /> Add
            </button>
          </div>
          <p className="text-[var(--text-faint)] text-[9px] mt-1.5">Drag rows to reorder · Edit label inline · field_key must be unique</p>
        </div>
        <div className="px-5 py-3 flex gap-2 justify-end border-t border-[var(--border-soft)]">
          <button onClick={onClose} className="h-8 px-4 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] text-xs transition-colors">Cancel</button>
          <button onClick={() => { onSave(cols); onClose(); }}
            className="h-8 px-5 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-xs transition-colors">
            Save Columns
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}

// ── Row Modal ──────────────────────────────────────────────────
function RowModal({ title, columns, prefill = {}, onSave, onClose }) {
  const [vals, setVals] = useState(() => {
    const init = {};
    columns.forEach(c => { init[c.key] = prefill[c.key] || ""; });
    return init;
  });

  const set = (key, val) => setVals(p => ({ ...p, [key]: val }));

  return (
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <ModalPanel className="w-[480px] max-h-[85vh] flex flex-col rounded-2xl overflow-hidden border border-[var(--border)] shadow-2xl" style={{ background: "var(--bg-surface-2)" }}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border-soft)]">
          <span className="text-[#3B82F6] font-bold text-sm">{title}</span>
          <button onClick={onClose} className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] transition-colors"><IconX /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-3">
          {columns.map(col => (
            <div key={col.key} className="flex items-center gap-3">
              <span className="text-[var(--text-secondary)] text-[10px] font-bold w-[160px] shrink-0 leading-tight">{col.label}</span>
              <input
                value={vals[col.key]}
                onChange={e => set(col.key, e.target.value)}
                onKeyDown={e => e.key === "Enter" && onSave(vals)}
                className="flex-1 h-9 bg-[var(--bg-surface)] border border-[var(--border)] focus:border-[#22C55E]/60 text-[var(--text-primary)] text-xs rounded-lg px-3 outline-none transition-colors"
              />
            </div>
          ))}
        </div>
        <div className="px-5 py-3 flex gap-2 justify-end border-t border-[var(--border-soft)]">
          <button onClick={onClose} className="h-8 px-4 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] text-xs transition-colors">Cancel</button>
          <button onClick={() => { onSave(vals); onClose(); }}
            className="h-8 px-5 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-xs transition-colors">
            Save
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}

// ── Context Menu ─────────────────────────────────────────────
function ContextMenu({ x, y, onEdit, onDelete, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <motion.div
      ref={ref}
      className="fixed z-50 rounded-xl overflow-hidden border border-[var(--border)] shadow-2xl py-1"
      style={{ left: x, top: y, background: "var(--bg-elevated)", minWidth: 160 }}
      variants={dropdownVariants}
      initial="hidden"
      animate="visible"
      exit="exit"
    >
      <button onClick={onEdit} className="w-full text-left px-4 py-2.5 text-xs text-[var(--text-secondary)] hover:bg-[#2563EB] hover:text-white transition-colors flex items-center gap-2.5">
        <span className="text-[var(--text-muted)]"><IconEdit /></span> Edit
      </button>
      <div className="h-px bg-[var(--border)] mx-3" />
      <button onClick={onDelete} className="w-full text-left px-4 py-2.5 text-xs text-[var(--text-secondary)] hover:bg-[#EF4444] hover:text-white transition-colors flex items-center gap-2.5">
        <span className="text-[var(--text-muted)]"><IconTrash /></span> Delete
      </button>
    </motion.div>
  );
}

// ── Confirm Dialog ────────────────────────────────────────────
function ConfirmDialog({ message, onConfirm, onCancel }) {
  return (
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <ModalPanel className="w-80 rounded-2xl border border-[var(--border)] overflow-hidden shadow-2xl" style={{ background: "var(--bg-surface-2)" }}>
        <div className="px-6 pt-6 pb-4">
          <p className="text-[var(--text-primary)] text-sm font-semibold mb-1">Confirm Delete</p>
          <p className="text-[var(--text-secondary)] text-xs">{message}</p>
        </div>
        <div className="px-6 pb-5 flex gap-2 justify-end">
          <button onClick={onCancel} className="h-8 px-4 rounded-xl border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] text-xs transition-colors">Cancel</button>
          <button onClick={onConfirm} className="h-8 px-4 rounded-xl bg-[#EF4444] hover:bg-[#DC2626] text-white font-bold text-xs transition-colors">Delete</button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}

// ── MAIN COMPONENT ──────────────────────────────────────────
export default function ReferencePage({ user }) {
  // ── State ────────────────────────────────────────────────────
  const [columns, setColumns] = useState([]);
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 🛑 Menghapus state dateFrom dan dateTo

  const [searchText, setSearchText] = useState(""); // Search by Keyword

  const [sortCol, setSortCol] = useState(null);
  const [sortDir, setSortDir] = useState("asc");

  const [page, setPage] = useState(1);
  const PER_PAGE = 50;

  const [showColMgr, setShowColMgr] = useState(false);
  const [editRow, setEditRow] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);

  // ── Fetch columns ──────────────────────────────────────────
  const fetchColumns = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/reference/columns`);
      if (!r.ok) throw new Error("Failed to load columns");
      const cols = await r.json();
      setColumns(cols);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  // ── Fetch data ─────────────────────────────────────────────
  const fetchData = useCallback(async (opts = {}) => {
    setLoading(true); setError("");
    try {
      // 🛑 Menghapus parameter date_from dan date_to dari URLSearchParams
      const params = new URLSearchParams({
        page: opts.page ?? page,
        per: PER_PAGE,
        ...(opts.searchText ? { q: opts.searchText } : {}),
      });
      const r = await fetch(`${API}/api/reference/data?${params}`);
      if (!r.ok) throw new Error("Failed to load data");
      const d = await r.json();
      setData(d.data || []);
    } catch (e) {
      setError(e.message);
      setData([]);
    } finally { setLoading(false); }
  }, [page]);

  // ── Inisialisasi ──────────────────────────────────────────
  useEffect(() => {
    fetchColumns();
    fetchData();
  }, [fetchColumns, fetchData]);

  // ── Sort ────────────────────────────────────────────────────
  const sorted = [...data].sort((a, b) => {
    if (!sortCol) return 0;
    const av = String(a[sortCol] || ""), bv = String(b[sortCol] || "");
    return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const handleSort = (key) => {
    if (sortCol === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortCol(key); setSortDir("asc"); }
  };

  // ── Search ──────────────────────────────────────────────────
  // 🛑 Menghapus searchByDate
  const searchByText = () => { setPage(1); fetchData({ page: 1, searchText }); };
  const clearSearch = () => { setSearchText(""); setPage(1); fetchData({ page: 1 }); };

  // ── CRUD ────────────────────────────────────────────────────
  const doAdd = async (vals) => {
    try {
      await fetch(`${API}/api/reference/data`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vals),
      });
      fetchData();
    } catch (e) { setError(e.message); }
  };

  const doEdit = async (vals) => {
    try {
      await fetch(`${API}/api/reference/data/${editRow.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vals),
      });
      fetchData();
    } catch (e) { setError(e.message); }
  };

  const doDelete = async (row) => {
    try {
      await fetch(`${API}/api/reference/data/${row.id}`, { method: "DELETE" });
      fetchData();
    } catch (e) { setError(e.message); }
    setConfirmDelete(null);
  };

  // ── Simpan perubahan kolom ──────────────────────────────────
  const saveColumns = async (newCols) => {
    try {
      await fetch(`${API}/api/reference/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columns: newCols }),
      });
      await fetchColumns();
      fetchData();
    } catch (e) { setError(e.message); }
  };

  // ── Export CSV ──────────────────────────────────────────────
  const exportCSV = () => {
    if (data.length === 0) return;
    const headers = columns.map(c => c.label).join(",");
    const rows = data.map(row =>
      columns.map(c => `"${String(row[c.key] || "").replace(/"/g, '""')}"`).join(",")
    );
    const csv = [headers, ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `Reference_List.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ── Right click ─────────────────────────────────────────────
  const handleRightClick = (e, row) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, row });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col bg-[var(--bg-canvas)] overflow-hidden font-sans transition-colors">

      {/* Toolbar */}
      <div className="shrink-0 bg-[var(--bg-surface-2)] border-b border-[var(--border-soft)] px-4 py-3 flex flex-wrap items-center gap-x-6 gap-y-3">

        {/* Judul */}
        <div className="flex items-center gap-2">
          <span className="text-[var(--text-secondary)] text-[9px] font-bold uppercase tracking-wider">Reference Master</span>
          <span className="text-[#22C55E] text-sm font-bold bg-[var(--bg-surface)] px-3 py-1 rounded-lg border border-[var(--border-soft)]">
            {data.length} records
          </span>
        </div>

        {/* 🛑 Menghapus Separator dan Search by Date di sini */}

        <div className="w-px h-8 bg-[var(--border-soft)]" />

        {/* Search by Keyword */}
        <div className="flex flex-col gap-1">
          <span className="text-[var(--text-secondary)] text-[9px] font-bold uppercase tracking-wider">Search by Keyword</span>
          <div className="flex items-center gap-2">
            <div className="flex items-center bg-[var(--bg-surface)] border border-[var(--border)] focus-within:border-[#22C55E]/60 rounded-lg px-3 h-8 gap-2 transition-colors">
              <span className="text-[var(--text-muted)]"><IconSearch /></span>
              <input
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                onKeyDown={e => e.key === "Enter" && searchByText()}
                placeholder="Type to search..."
                className="bg-transparent text-[var(--text-primary)] text-xs placeholder-[var(--text-faint)] outline-none w-48"
              />
              {searchText && (
                <button onClick={clearSearch} className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"><IconX /></button>
              )}
            </div>
            <button onClick={searchByText} className="h-8 px-3 rounded-lg bg-[#3B82F6] hover:bg-[#2563EB] text-white font-bold text-[10px] transition-colors flex items-center gap-1.5">
              <IconSearch /> Search
            </button>
          </div>
        </div>

        {/* Right actions */}
        <div className="ml-auto flex items-center gap-2">
          {error && <span className="text-[#EF4444] text-[10px] max-w-[200px] truncate">⚠ {error}</span>}
          {loading && <span className="text-[#22C55E] text-[10px] font-mono animate-pulse">Loading…</span>}
          <span className="text-[var(--text-muted)] text-[10px] font-mono">{data.length} records</span>

          <button
            onClick={() => setShowColMgr(true)}
            className="h-8 px-3 rounded-lg border border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] text-[10px] font-bold transition-colors flex items-center gap-1.5"
          >
            <IconColumns /> Columns
          </button>

          <button
            onClick={() => setEditRow({})}
            className="h-8 px-3 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-[10px] transition-colors flex items-center gap-1.5"
          >
            <IconPlus /> Add
          </button>

          <button
            onClick={exportCSV}
            disabled={data.length === 0}
            className="h-8 px-3 rounded-lg bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-[10px] transition-colors flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <IconDownload /> CSV
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto min-h-0" style={{ scrollbarWidth: "thin", scrollbarColor: "#3B82F6 var(--bg-surface)" }}>
        <table className="w-full text-xs border-collapse" style={{ minWidth: columns.length * 130 }}>
          <thead className="sticky top-0 z-10">
            <tr style={{ background: "#1E3A5F" }}>
              <th className="w-10 px-3 py-2.5 text-center text-[#94A3B8] text-[10px] font-bold uppercase tracking-wider border-b border-[#2A3A5C]">No</th>
              {columns.map(col => (
                <th
                  key={col.key}
                  onClick={() => handleSort(col.key)}
                  className="px-3 py-2.5 text-center text-[#94A3B8] text-[10px] font-bold uppercase tracking-wider border-b border-[#2A3A5C] cursor-pointer hover:text-white hover:bg-[#1E4A7A] transition-colors select-none whitespace-nowrap"
                  style={{ minWidth: col.width || 120 }}
                >
                  <div className="flex items-center justify-center gap-1.5">
                    {col.label}
                    {sortCol === col.key && <span className="text-[#22C55E]"><IconSort dir={sortDir} /></span>}
                  </div>
                </th>
              ))}
              <th className="w-16 px-3 py-2.5 text-center text-[#94A3B8] text-[10px] font-bold uppercase tracking-wider border-b border-[#2A3A5C]">Action</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, idx) => (
              <tr
                key={row.id}
                onContextMenu={e => handleRightClick(e, row)}
                onDoubleClick={() => setEditRow(row)}
                className="border-b border-[var(--border-soft)] cursor-pointer transition-colors"
                style={{ background: idx % 2 === 0 ? "var(--bg-surface)" : "var(--bg-surface-2)" }}
                onMouseEnter={e => e.currentTarget.style.background = "var(--bg-hover)"}
                onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? "var(--bg-surface)" : "var(--bg-surface-2)"}
              >
                <td className="px-3 py-2 text-center text-[var(--text-muted)] font-mono">{(page-1)*PER_PAGE + idx + 1}</td>
                {columns.map(col => (
                  <td key={col.key} className="px-3 py-2 text-center text-[var(--text-primary)] whitespace-nowrap">
                    {row[col.key] ?? "—"}
                  </td>
                ))}
                <td className="px-3 py-2 text-center">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={e => { e.stopPropagation(); setEditRow(row); }} className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[#3B82F6] hover:bg-[var(--bg-hover)] transition-colors">
                      <IconEdit />
                    </button>
                    <button onClick={e => { e.stopPropagation(); setConfirmDelete(row); }} className="w-6 h-6 rounded-md flex items-center justify-center text-[var(--text-muted)] hover:text-[#EF4444] hover:bg-[#7F1D1D]/20 transition-colors">
                      <IconTrash />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {sorted.length === 0 && !loading && (
              <tr>
                <td colSpan={columns.length + 2} className="py-16 text-center text-[var(--text-faint)] text-xs">
                  <div className="flex flex-col items-center gap-2">
                    <span className="text-3xl opacity-20">📋</span>
                    <span>No records found</span>
                  </div>
                </td>
              </tr>
            )}
            {loading && (
              <tr>
                <td colSpan={columns.length + 2} className="py-10 text-center">
                  <div className="flex items-center justify-center gap-2 text-[#22C55E] text-xs">
                    <div className="w-3.5 h-3.5 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin" />
                    Loading…
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-t border-[var(--border-soft)]" style={{ background: "var(--bg-surface-2)" }}>
        <div className="flex items-center gap-1">
          {[
            { label: "«", action: () => setPage(1) },
            { label: "‹", action: () => setPage(p => Math.max(1, p-1)) },
            { label: String(page), page, action: () => {} },
            { label: "›", action: () => setPage(p => p+1) },
          ].map((b, i) => (
            <button
              key={i}
              onClick={b.action}
              className="px-2.5 py-1 rounded-lg text-[10px] transition-colors"
              style={{
                background: b.page === page ? "#22C55E" : "var(--bg-elevated)",
                color: b.page === page ? "#0B1120" : "var(--text-secondary)",
                fontWeight: b.page === page ? "700" : "400",
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
        <span className="text-[var(--text-muted)] text-[10px] font-mono">Total Records : {data.length}</span>
      </div>

      {/* Modals */}
      <AnimatePresence>
        {showColMgr && (
          <ColumnManagerModal
            key="col-mgr"
            columns={columns}
            onSave={saveColumns}
            onClose={() => setShowColMgr(false)}
          />
        )}

        {editRow && (
          <RowModal
            key="row-modal"
            title={editRow.id ? "Edit Record" : "Add Record"}
            columns={columns}
            prefill={editRow}
            onSave={editRow.id ? doEdit : doAdd}
            onClose={() => setEditRow(null)}
          />
        )}

        {confirmDelete && (
          <ConfirmDialog
            key="confirm-delete"
            message="Delete this record? This action cannot be undone."
            onConfirm={() => doDelete(confirmDelete)}
            onCancel={() => setConfirmDelete(null)}
          />
        )}

        {contextMenu && (
          <ContextMenu
            key="context-menu"
            x={contextMenu.x}
            y={contextMenu.y}
            onEdit={() => { setEditRow(contextMenu.row); setContextMenu(null); }}
            onDelete={() => { setConfirmDelete(contextMenu.row); setContextMenu(null); }}
            onClose={() => setContextMenu(null)}
          />
        )}
      </AnimatePresence>

      <style>{`
        table tbody tr { transition: background 0.1s; }
        ::-webkit-scrollbar { width: 4px; height: 4px; }
        ::-webkit-scrollbar-track { background: var(--bg-surface); }
        ::-webkit-scrollbar-thumb { background: #3B82F6; border-radius: 10px; }
        ::-webkit-scrollbar-thumb:hover { background: #60A5FA; }
      `}</style>
    </div>
  );
}