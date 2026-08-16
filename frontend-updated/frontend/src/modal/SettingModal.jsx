// src/modal/SettingModal.jsx
import { useState, useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { API } from "../service/api";
import { ModalBackdrop, ModalPanel } from "../components/motion";
import { useTheme } from "../context/ThemeContext";

const IconSun = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="4" />
    <line x1="12" y1="2" x2="12" y2="4" /><line x1="12" y1="20" x2="12" y2="22" />
    <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
    <line x1="2" y1="12" x2="4" y2="12" /><line x1="20" y1="12" x2="22" y2="12" />
    <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
  </svg>
);

const IconMoon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

// ── Appearance: Light / Dark toggle ──────────────────────────
function AppearanceSection() {
  const { theme, setTheme } = useTheme();
  const isLight = theme === "light";

  return (
    <div>
      <p className="text-xs font-mono text-[#22C55E] uppercase tracking-widest mb-3">Appearance</p>
      <div className="bg-[var(--bg-surface-2)] rounded-xl border border-[var(--border-soft)] overflow-hidden">
        <div className="flex items-center gap-4 px-4 py-3">
          <span className="text-[var(--text-secondary)] text-sm w-44 shrink-0">Theme</span>
          <div className="flex-1 flex bg-[var(--bg-surface)] rounded-lg p-1 border border-[var(--border)] max-w-[220px]">
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`relative flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${!isLight ? "text-white" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
            >
              {!isLight && <motion.span layoutId="theme-pill" className="absolute inset-0 bg-[#22C55E] rounded-md" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
              <span className="relative flex items-center gap-1.5"><IconMoon /> Dark</span>
            </button>
            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`relative flex-1 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 ${isLight ? "text-[#052E16]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}
            >
              {isLight && <motion.span layoutId="theme-pill" className="absolute inset-0 bg-[#22C55E] rounded-md" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
              <span className="relative flex items-center gap-1.5"><IconSun /> Light</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Icons ───────────────────────────────────────────────────────
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

// ── Constants ──────────────────────────────────────────────────
const COLOR_OPTIONS = ["Green", "Red", "Yellow", "White", "Blue", "Orange"];
const FONT_OPTIONS = [
  "Arial 24 Bold",
  "Arial 20 Bold",
  "Arial 16 Bold",
  "Segoe UI 24 Bold",
  "Courier 20 Bold",
];
const BAUD_OPTIONS = ["1200", "2400", "4800", "9600", "19200", "38400", "57600", "115200"];
const PARITY_OPTIONS = ["None", "Even", "Odd"];
const DATA_BITS_OPTIONS = ["5", "6", "7", "8"];
const STOP_BITS_OPTIONS = ["1", "1.5", "2"];

// ── Urutan field ──────────────────────────────────────────────
const FIELD_ORDER = {
  "Message": ["OK Color", "OK Font", "NOK Color", "NOK Font"],
  "Product Matrix Mapping": [
    "Part Matrix", "PN", "Vendor", "Voltage", "HW Ver",
    "FW Ver", "ESP FW", "Date", "Serial Number"
  ],
  "SN Chassis Mapping": [
    "Product Matrix", "Date", "Type", "Line", "Serial Number",
    "Partner", "Voltage", "Plug", "Color"
  ]
};

const reorderData = (data) => {
  const result = {};
  for (const section of Object.keys(data)) {
    const fields = data[section];
    const order = FIELD_ORDER[section];
    if (order) {
      const ordered = {};
      for (const key of order) {
        if (key in fields) ordered[key] = fields[key];
      }
      for (const key of Object.keys(fields)) {
        if (!(key in ordered)) ordered[key] = fields[key];
      }
      result[section] = ordered;
    } else {
      result[section] = fields;
    }
  }
  return result;
};

// ── Modal Custom untuk Add/Edit Product ──────────────────────
function ProductFormModal({ isEdit, initialData, onSave, onClose }) {
  const [product, setProduct] = useState(initialData?.Product || "");
  const [voltage, setVoltage] = useState(initialData?.["Part Voltage"] || "");

  const handleSave = () => {
    if (!product.trim() || !voltage.trim()) return;
    onSave(product.trim(), voltage.trim());
    onClose();
  };

  return (
    <ModalBackdrop className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <ModalPanel className="bg-[var(--bg-surface)] border border-[var(--border-soft)] rounded-xl w-[380px] shadow-2xl p-6">
        <h3 className="text-[var(--text-primary)] font-semibold text-lg mb-4">
          {isEdit ? "Edit Product Rule" : "Add Product Rule"}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-[var(--text-secondary)] text-sm block mb-1">Product</label>
            <input
              type="text"
              value={product}
              onChange={(e) => setProduct(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
              placeholder="e.g. 1"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[var(--text-secondary)] text-sm block mb-1">Part Voltage</label>
            <input
              type="text"
              value={voltage}
              onChange={(e) => setVoltage(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
              placeholder="e.g. 127V"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--text-muted)] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-sm font-semibold bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] rounded-lg transition-colors"
          >
            {isEdit ? "Save" : "Add"}
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}

// ── Modal Custom untuk Add/Edit Device ──────────────────────
function DeviceFormModal({ isEdit, initialData, onSave, onClose }) {
  const [name, setName] = useState(initialData?.["Device Name"] || "");
  const [type, setType] = useState(initialData?.Type || "TCP");
  const [ip, setIp] = useState(initialData?.["IP Address"] || "192.168.108.1");
  const [port, setPort] = useState(initialData?.Port || "9004");
  const [comPort, setComPort] = useState(initialData?.["COM Port"] || "COM3");
  const [baudrate, setBaudrate] = useState(initialData?.Baudrate || "115200");
  const [parity, setParity] = useState(initialData?.Parity || "None");
  const [dataBits, setDataBits] = useState(initialData?.["Data Bits"] || "8");
  const [stopBits, setStopBits] = useState(initialData?.["Stop Bits"] || "1");

  const handleSave = () => {
    if (!name.trim()) return;
    const device = { "Device Name": name.trim(), Type: type };
    if (type === "TCP") {
      device["IP Address"] = ip.trim() || "192.168.108.1";
      device.Port = port.trim() || "9004";
    } else {
      device["COM Port"] = comPort.trim() || "COM3";
      device.Baudrate = baudrate;
      device.Parity = parity;
      device["Data Bits"] = dataBits;
      device["Stop Bits"] = stopBits;
    }
    onSave(device);
    onClose();
  };

  return (
    <ModalBackdrop className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <ModalPanel className="bg-[var(--bg-surface)] border border-[var(--border-soft)] rounded-xl w-[420px] max-h-[90vh] overflow-y-auto shadow-2xl p-6">
        <h3 className="text-[var(--text-primary)] font-semibold text-lg mb-4">
          {isEdit ? "Edit Device" : "Add Device"}
        </h3>
        <div className="space-y-3">
          <div>
            <label className="text-[var(--text-secondary)] text-sm block mb-1">Device Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
              placeholder="e.g. PSN"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[var(--text-secondary)] text-sm block mb-1">Type</label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value)}
              className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
            >
              <option value="TCP">TCP</option>
              <option value="COM">COM</option>
            </select>
          </div>
          {type === "TCP" ? (
            <>
              <div>
                <label className="text-[var(--text-secondary)] text-sm block mb-1">IP Address</label>
                <input
                  type="text"
                  value={ip}
                  onChange={(e) => setIp(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
                  placeholder="192.168.108.1"
                />
              </div>
              <div>
                <label className="text-[var(--text-secondary)] text-sm block mb-1">Port</label>
                <input
                  type="text"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
                  placeholder="9004"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="text-[var(--text-secondary)] text-sm block mb-1">COM Port</label>
                <input
                  type="text"
                  value={comPort}
                  onChange={(e) => setComPort(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
                  placeholder="COM3"
                />
              </div>
              <div>
                <label className="text-[var(--text-secondary)] text-sm block mb-1">Baudrate</label>
                <select
                  value={baudrate}
                  onChange={(e) => setBaudrate(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
                >
                  {BAUD_OPTIONS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[var(--text-secondary)] text-sm block mb-1">Parity</label>
                <select
                  value={parity}
                  onChange={(e) => setParity(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
                >
                  {PARITY_OPTIONS.map((p) => <option key={p}>{p}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[var(--text-secondary)] text-sm block mb-1">Data Bits</label>
                <select
                  value={dataBits}
                  onChange={(e) => setDataBits(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
                >
                  {DATA_BITS_OPTIONS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[var(--text-secondary)] text-sm block mb-1">Stop Bits</label>
                <select
                  value={stopBits}
                  onChange={(e) => setStopBits(e.target.value)}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-2 focus:outline-none focus:border-[#22C55E] transition-colors"
                >
                  {STOP_BITS_OPTIONS.map((b) => <option key={b}>{b}</option>)}
                </select>
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--text-muted)] rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="px-5 py-2 text-sm font-semibold bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] rounded-lg transition-colors"
          >
            {isEdit ? "Save" : "Add"}
          </button>
        </div>
      </ModalPanel>
    </ModalBackdrop>
  );
}

// ── Main Component ─────────────────────────────────────────────
export default function SettingModal({ onClose, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [entries, setEntries] = useState({});
  const [productRows, setProductRows] = useState([]);
  const [deviceRows, setDeviceRows] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // State untuk modal form
  const [showAddProduct, setShowAddProduct] = useState(false);
  const [showEditProduct, setShowEditProduct] = useState(false);
  const [editProductIndex, setEditProductIndex] = useState(-1);
  const [editProductData, setEditProductData] = useState(null);

  const [showAddDevice, setShowAddDevice] = useState(false);
  const [showEditDevice, setShowEditDevice] = useState(false);
  const [editDeviceIndex, setEditDeviceIndex] = useState(-1);
  const [editDeviceData, setEditDeviceData] = useState(null);

  // ── Load ─────────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/api/settings`)
      .then((r) => r.json())
      .then((data) => {
        const copy = JSON.parse(JSON.stringify(data));
        delete copy["Product Rules"];
        delete copy["Communication Devices"];
        setEntries(copy);
        setProductRows(data["Product Rules"]?.["_table"] || []);
        setDeviceRows(data["Communication Devices"]?.["_table"] || []);
        setLoading(false);
      })
      .catch(() => {
        setEntries({});
        setProductRows([]);
        setDeviceRows([]);
        setLoading(false);
      });
  }, []);

  // ── Handlers ─────────────────────────────────────────────────
  const handleFieldChange = (section, key, val) => {
    setEntries((prev) => ({
      ...prev,
      [section]: { ...prev[section], [key]: val },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const data = { ...entries };
      data["Product Rules"] = { _table: productRows };
      data["Communication Devices"] = { _table: deviceRows };
      const orderedData = reorderData(data);
      const r = await fetch(`${API}/api/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data: orderedData }),
      });
      const d = await r.json();
      if (d.success) {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
        if (onSaved) onSaved();
      }
    } catch (e) {
      console.error("Save error:", e);
    }
    setSaving(false);
  };

  // ── Product CRUD ─────────────────────────────────────────────
  const addProductRow = (product, voltage) => {
    setProductRows(prev => [...prev, { Product: product, "Part Voltage": voltage }]);
  };
  const editProductRow = (index, product, voltage) => {
    setProductRows(prev => {
      const newRows = [...prev];
      newRows[index] = { Product: product, "Part Voltage": voltage };
      return newRows;
    });
  };
  const deleteProductRow = (index) => {
    setProductRows(prev => prev.filter((_, i) => i !== index));
  };

  // ── Device CRUD ──────────────────────────────────────────────
  const addDeviceRow = (device) => {
    setDeviceRows(prev => [...prev, device]);
  };
  const editDeviceRow = (index, device) => {
    setDeviceRows(prev => {
      const newRows = [...prev];
      newRows[index] = device;
      return newRows;
    });
  };
  const deleteDeviceRow = (index) => {
    setDeviceRows(prev => prev.filter((_, i) => i !== index));
  };

  // ── Render ───────────────────────────────────────────────────
  if (loading) {
    return (
      <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="w-8 h-8 border-2 border-[#22C55E] border-t-transparent rounded-full animate-spin" />
      </ModalBackdrop>
    );
  }

  return (
    <ModalBackdrop className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <ModalPanel className="bg-[var(--bg-surface)] border border-[var(--border-soft)] rounded-2xl w-[640px] max-h-[85vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-soft)]">
          <div>
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-widest font-mono mb-0.5">Configuration</p>
            <h2 className="text-[var(--text-primary)] font-semibold text-base">System Configuration</h2>
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
          <AppearanceSection />

          {Object.entries(entries).map(([section, fields]) => {
            const orderedKeys = FIELD_ORDER[section] || Object.keys(fields);
            const keysToRender = orderedKeys.filter(key => key in fields);
            const extraKeys = Object.keys(fields).filter(key => !orderedKeys.includes(key));
            const allKeys = [...keysToRender, ...extraKeys];

            return (
              <div key={section}>
                <p className="text-xs font-mono text-[#22C55E] uppercase tracking-widest mb-3">{section}</p>
                <div className="bg-[var(--bg-surface-2)] rounded-xl border border-[var(--border-soft)] overflow-hidden">
                  {allKeys.map((key, i, arr) => {
                    const val = fields[key];
                    let options = null;
                    if (section === "Message") {
                      if (key === "OK Color" || key === "NOK Color") options = COLOR_OPTIONS;
                      if (key === "OK Font" || key === "NOK Font") options = FONT_OPTIONS;
                    }
                    return (
                      <div
                        key={key}
                        className={`flex items-center gap-4 px-4 py-3 ${
                          i < arr.length - 1 ? "border-b border-[var(--border-soft)]" : ""
                        }`}
                      >
                        <span className="text-[var(--text-secondary)] text-sm w-44 shrink-0">{key}</span>
                        {options ? (
                          <select
                            value={entries[section]?.[key] ?? val}
                            onChange={(e) => handleFieldChange(section, key, e.target.value)}
                            className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#22C55E] transition-colors"
                          >
                            {options.map((opt) => (
                              <option key={opt}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type="text"
                            value={entries[section]?.[key] ?? val}
                            onChange={(e) => handleFieldChange(section, key, e.target.value)}
                            className="flex-1 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-primary)] text-sm rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#22C55E] transition-colors"
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* ── Product Rules Table ────────────────────────────── */}
          <div>
            <p className="text-xs font-mono text-[#22C55E] uppercase tracking-widest mb-3">Product Rules</p>
            <div className="bg-[var(--bg-surface-2)] rounded-xl border border-[var(--border-soft)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#1E3A5F]">
                  <tr>
                    <th className="text-white font-semibold py-2 px-3 text-center">Product</th>
                    <th className="text-white font-semibold py-2 px-3 text-center">Part Voltage</th>
                    <th className="text-white font-semibold py-2 px-3 text-center w-28">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {productRows.map((row, idx) => (
                    <tr key={idx} className="border-t border-[var(--border-soft)]">
                      <td className="py-2 px-3 text-center text-[var(--text-primary)]">{row.Product}</td>
                      <td className="py-2 px-3 text-center text-[var(--text-primary)]">{row["Part Voltage"]}</td>
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          onClick={() => {
                            setEditProductIndex(idx);
                            setEditProductData(row);
                            setShowEditProduct(true);
                          }}
                          className="text-[#3B82F6] hover:text-[#60A5FA] text-xs font-medium mr-2"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteProductRow(idx)}
                          className="text-[#EF4444] hover:text-[#F87171] text-xs font-medium"
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="p-2 border-t border-[var(--border-soft)]">
                <button
                  type="button"
                  onClick={() => setShowAddProduct(true)}
                  className="px-3 py-1 text-xs font-semibold bg-[#10B981] hover:bg-[#059669] text-[#052E16] rounded-md transition-colors"
                >
                  Add Row
                </button>
              </div>
            </div>
          </div>

          {/* ── Communication Devices Table ─────────────────────── */}
          <div>
            <p className="text-xs font-mono text-[#22C55E] uppercase tracking-widest mb-3">Communication Devices</p>
            <div className="bg-[var(--bg-surface-2)] rounded-xl border border-[var(--border-soft)] overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-[#1E3A5F]">
                  <tr>
                    <th className="text-white font-semibold py-2 px-3 text-center">Device Name</th>
                    <th className="text-white font-semibold py-2 px-3 text-center">Type</th>
                    <th className="text-white font-semibold py-2 px-3 text-center">Configuration</th>
                    <th className="text-white font-semibold py-2 px-3 text-center w-28">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deviceRows.map((row, idx) => {
                    let config = "";
                    if (row.Type === "TCP") {
                      config = `${row["IP Address"] || ""}:${row.Port || ""}`;
                    } else {
                      config = `${row["COM Port"] || ""} @ ${row.Baudrate || ""}`;
                    }
                    return (
                      <tr key={idx} className="border-t border-[var(--border-soft)]">
                        <td className="py-2 px-3 text-center text-[var(--text-primary)]">{row["Device Name"]}</td>
                        <td className="py-2 px-3 text-center text-[var(--text-primary)]">{row.Type}</td>
                        <td className="py-2 px-3 text-center text-[var(--text-secondary)] text-xs font-mono">{config}</td>
                        <td className="py-2 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => {
                              setEditDeviceIndex(idx);
                              setEditDeviceData(row);
                              setShowEditDevice(true);
                            }}
                            className="text-[#3B82F6] hover:text-[#60A5FA] text-xs font-medium mr-2"
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteDeviceRow(idx)}
                            className="text-[#EF4444] hover:text-[#F87171] text-xs font-medium"
                          >
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <div className="p-2 border-t border-[var(--border-soft)]">
                <button
                  type="button"
                  onClick={() => setShowAddDevice(true)}
                  className="px-3 py-1 text-xs font-semibold bg-[#10B981] hover:bg-[#059669] text-[#052E16] rounded-md transition-colors"
                >
                  Add Device
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-col gap-2 px-6 py-4 border-t border-[var(--border-soft)]">
          <div className="flex items-center justify-between">
            <p className={`text-sm transition-all duration-300 flex items-center gap-1.5 ${saved ? "text-[#22C55E] opacity-100" : "opacity-0"}`}>
              <IconCheck /> Saved successfully
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] border border-[var(--border)] hover:border-[var(--text-muted)] rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="px-5 py-2 text-sm font-semibold bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2"
              >
                {saving && <div className="w-4 h-4 border-2 border-[#052E16] border-t-transparent rounded-full animate-spin" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      </ModalPanel>

      {/* ── Modal Popups ────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddProduct && (
          <ProductFormModal
            key="add-product"
            isEdit={false}
            onSave={(p, v) => { addProductRow(p, v); setShowAddProduct(false); }}
            onClose={() => setShowAddProduct(false)}
          />
        )}
        {showEditProduct && (
          <ProductFormModal
            key="edit-product"
            isEdit={true}
            initialData={editProductData}
            onSave={(p, v) => { editProductRow(editProductIndex, p, v); setShowEditProduct(false); }}
            onClose={() => setShowEditProduct(false)}
          />
        )}
        {showAddDevice && (
          <DeviceFormModal
            key="add-device"
            isEdit={false}
            onSave={(d) => { addDeviceRow(d); setShowAddDevice(false); }}
            onClose={() => setShowAddDevice(false)}
          />
        )}
        {showEditDevice && (
          <DeviceFormModal
            key="edit-device"
            isEdit={true}
            initialData={editDeviceData}
            onSave={(d) => { editDeviceRow(editDeviceIndex, d); setShowEditDevice(false); }}
            onClose={() => setShowEditDevice(false)}
          />
        )}
      </AnimatePresence>
    </ModalBackdrop>
  );
}