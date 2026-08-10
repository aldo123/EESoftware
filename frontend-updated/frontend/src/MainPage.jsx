// src/MainPage.jsx
import { useState, useEffect, useRef } from "react";
import InterlockModal from "./modal/InterlockModal";
import SettingModal from "./modal/SettingModal";
import MaintenancePage from "./modal/MaintenanceModal";
import SNListPage from "./modal/SnlistModal";
import ReferencePage from "./modal/ReferenceModal";
import PageBuilder from "./modal/PageBuilder";
import LogicBuilder from "./modal/LogicBuilder";
import { API } from "./service/api";
import DynamicCPPage from "./pages/DynamicCPPage";
import { useRS232Scanner } from "./hooks/useRS232Scanner";
import { useTCPPLC } from "./hooks/useTCPPLC";

// ── Icons ─────────────────────────────────────────────────────
const IconGear = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconUser = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" />
  </svg>
);

const IconKey = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4" />
  </svg>
);

const IconRefresh = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
  </svg>
);

const IconInterlock = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

const IconSetting2 = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="20" y2="12" /><line x1="12" y1="18" x2="20" y2="18" />
    <circle cx="2" cy="6" r="1" fill="currentColor" /><circle cx="6" cy="12" r="1" fill="currentColor" /><circle cx="10" cy="18" r="1" fill="currentColor" />
  </svg>
);

const IconLogic = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

// ── Menu items ────────────────────────────────────────────────
const MENU_ITEMS = ["Main", "Maintenance", "SN List", "Reference"];

// ── Field (reused) ─────────────────────────────────────────────
function Field({ icon, placeholder, value, onChange, onKeyDown, type = "text" }) {
  return (
    <div className="flex items-center bg-[#0F172A] border border-[#1E293B] focus-within:border-[#22C55E]/60 rounded-xl px-3 h-11 gap-2.5 transition-colors group">
      <span className="text-[#475569] group-focus-within:text-[#22C55E] transition-colors shrink-0">{icon}</span>
      <input
        type={type}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        className="flex-1 bg-transparent text-white text-sm placeholder-[#334155] outline-none"
      />
    </div>
  );
}

// ── Dropdown menu ──────────────────────────────────────────────
function DropdownMenu({ anchorRef, items, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    function handle(e) {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
        anchorRef.current && !anchorRef.current.contains(e.target)) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose, anchorRef]);

  return (
    <div
      ref={menuRef}
      className="absolute right-0 top-full mt-1 w-52 z-50 rounded-xl overflow-hidden border border-[#334155] shadow-2xl"
      style={{ background: "#111827" }}
    >
      {items.map((item, i) =>
        item === "---" ? (
          <div key={i} className="h-px bg-[#1E293B] mx-3" />
        ) : (
          <button
            key={i}
            onClick={() => { item.action(); onClose(); }}
            className="w-full text-left px-4 py-2.5 text-sm text-[#94A3B8] hover:bg-[#2563EB] hover:text-white transition-colors flex items-center gap-2.5"
          >
            <span className="text-[#475569] group-hover:text-white">{item.icon}</span>
            {item.label}
          </button>
        )
      )}
    </div>
  );
}

// ── Modal: Change Password ─────────────────────────────────────
function ChangePasswordModal({ onClose, user }) {
  const [newPass, setNewPass] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    if (!newPass.trim()) { setError("Please enter new password"); return; }
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/users/change-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: user?.username, password: newPass }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Failed");
      onClose();
    } catch (e) { setError(e.message); }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[400px] rounded-2xl border border-[#22C55E]/30 overflow-hidden shadow-2xl" style={{ background: "#111827" }}>
        <div className="px-6 pt-6 pb-4">
          <p className="text-[#22C55E] font-bold text-lg mb-5">Change Password</p>
          <Field
            icon={<IconKey />}
            placeholder="New Password"
            value={newPass}
            onChange={e => setNewPass(e.target.value)}
            type="password"
            onKeyDown={e => e.key === "Enter" && save()}
          />
          {error && <p className="text-[#FCA5A5] text-xs mt-2">{error}</p>}
        </div>
        <div className="px-6 pb-6 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#334155] text-[#94A3B8] hover:bg-[#1E293B] text-sm transition-colors">
            Cancel
          </button>
          <button onClick={save} disabled={loading} className="flex-1 py-2.5 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-sm transition-colors disabled:opacity-40">
            {loading ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Downtime ────────────────────────────────────────────
function DowntimeModal({ onClose, onSelect }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[520px] rounded-2xl border border-[#334155] overflow-hidden shadow-2xl" style={{ background: "#0F172A" }}>
        <div className="px-8 pt-8 pb-6 text-center">
          <p className="text-[#22C55E] font-bold text-xl mb-1">SELECT DOWNTIME TYPE</p>
          <p className="text-[#94A3B8] text-sm mb-8">Please choose downtime category</p>
          <div className="flex gap-4">
            <button
              onClick={() => onSelect("maintenance")}
              className="flex-1 h-24 rounded-xl bg-[#DC2626] hover:bg-[#B91C1C] text-white font-bold text-sm transition-colors flex flex-col items-center justify-center gap-2"
            >
              <span className="text-2xl">🔧</span>
              CALL MAINTENANCE
            </button>
            <button
              onClick={() => onSelect("material")}
              className="flex-1 h-24 rounded-xl bg-[#F59E0B] hover:bg-[#D97706] text-white font-bold text-sm transition-colors flex flex-col items-center justify-center gap-2"
            >
              <span className="text-2xl">📦</span>
              WAITING MATERIAL
            </button>
          </div>
        </div>
        <div className="px-8 pb-6 flex justify-end">
          <button onClick={onClose} className="px-5 py-2 rounded-xl border border-[#334155] text-[#94A3B8] hover:bg-[#1E293B] text-sm transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Modal: Relogin ─────────────────────────────────────────────
function ReloginModal({ onClose, onLoginSuccess }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [cardId, setCardId] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      let endpoint = "";
      let payload = {};
      if (username && password) {
        endpoint = "/api/login/password";
        payload = { username, password };
      } else if (cardId) {
        endpoint = "/api/login/card";
        payload = { id_card: cardId };
      } else {
        setError("Please enter username/password or scan ID card");
        setLoading(false);
        return;
      }
      const r = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Login failed");
      onLoginSuccess(d.user);
      onClose();
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-[420px] bg-[#0F172A] border border-[#22C55E] rounded-2xl overflow-hidden shadow-2xl">
        <div className="flex flex-col items-center pt-6 pb-2">
          <div className="w-16 h-16 rounded-full bg-[#22C55E] flex items-center justify-center mb-2">
            <span className="text-2xl">🔒</span>
          </div>
          <p className="text-[#94A3B8] text-sm">Engineer Access Required</p>
        </div>

        <div className="px-6 py-4 space-y-4">
          <div>
            <label className="text-[#94A3B8] text-xs block mb-1">UserName</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full bg-[#1E293B] border border-[#334155] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#22C55E]"
              placeholder="👤 Username"
              autoFocus
            />
          </div>
          <div>
            <label className="text-[#94A3B8] text-xs block mb-1">Password</label>
            <div className="flex">
              <input
                type={showPwd ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="flex-1 bg-[#1E293B] border border-[#334155] text-white rounded-l-lg px-3 py-2 text-sm focus:outline-none focus:border-[#22C55E]"
                placeholder="🔒 Password"
              />
              <button
                onClick={() => setShowPwd(!showPwd)}
                className="bg-[#1A5C34] hover:bg-[#166534] text-white px-3 rounded-r-lg border border-[#334155] border-l-0"
              >
                {showPwd ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2 bg-[#374151] hover:bg-[#4B5563] text-white rounded-lg text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleLogin}
              disabled={loading}
              className="flex-1 py-2 bg-[#7C3AED] hover:bg-[#6D28D9] text-white font-semibold rounded-lg text-sm disabled:opacity-50"
            >
              {loading ? "Logging in..." : "OK"}
            </button>
          </div>

          <div className="border-t border-[#334155] pt-3">
            <div className="flex items-center gap-2">
              <div className="w-11 h-11 bg-[#1E293B] border border-[#334155] rounded-lg flex items-center justify-center text-[#94A3B8] text-lg">
                🪪
              </div>
              <input
                type="text"
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleLogin()}
                className="flex-1 bg-[#1E293B] border border-[#334155] text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#22C55E]"
                placeholder="Scan / tempel ID Card di sini..."
              />
            </div>
          </div>

          {error && <div className="text-[#EF4444] text-xs text-center">{error}</div>}
        </div>
      </div>
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────
export default function MainPage({ user: initialUser, onLogout }) {
  const [user, setUser] = useState(initialUser || { username: "Guest", role: "" });
  const [activeMenu, setActiveMenu] = useState("Main");
  const [time, setTime] = useState(new Date());
  const [dbStatus, setDbStatus] = useState(null);
  const [commDevices, setCommDevices] = useState([]);
  const [machineStatus, setMachineStatus] = useState("IDLE");

  // State untuk info CP dan Process Code
  const [cpInfo, setCpInfo] = useState({
    name: "CP20 V-Mini",
    code: "BW01-VM2",
    family: "CP02-PCBAVM2"
  });
  const [processCode, setProcessCode] = useState("");

  // State untuk sync downtime dengan MaintenancePage
  const [downtimeActive, setDowntimeActive] = useState(false);
  const [downtimeStart, setDowntimeStart] = useState(null);
  const [downtimeId, setDowntimeId] = useState(null);
  const [downtimeLoading, setDowntimeLoading] = useState(false);

  const [showSettingMenu, setShowSettingMenu] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showDowntime, setShowDowntime] = useState(false);
  const [showChangePass, setShowChangePass] = useState(false);
  const [showInterlock, setShowInterlock] = useState(false);
  const [showSetting, setShowSetting] = useState(false);
  const [showRelogin, setShowRelogin] = useState(false);
  const [showBuilder, setShowBuilder] = useState(false);
  const [showLogic, setShowLogic] = useState(false);

  const settingBtnRef = useRef(null);
  const userBtnRef = useRef(null);

  // ── Clock ──────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  // ── DB health ─────────────────────────────────────────────
  useEffect(() => {
    const check = () =>
      fetch(`${API}/api/health`)
        .then(r => r.json())
        .then(d => setDbStatus(d.db_connected))
        .catch(() => setDbStatus(false));
    check();
    const t = setInterval(check, 3000);
    return () => clearInterval(t);
  }, []);

  // ── CP info & Process Code from interlock.json ───────────────
  useEffect(() => {
    fetch(`${API}/api/interlock`)
      .then(r => r.json())
      .then(d => {
        const cp = d?.["Control Point"] || {};
        setCpInfo({
          name: cp["Control Point Name"] || "CP20 V-Mini",
          code: cp["Control Point Code"] || "BW01-VM2",
          family: cp["Control Point Family"] || "CP02-PCBAVM2",
        });
        const process = cp["Process"] || "";
        setProcessCode(process);
      })
      .catch(() => { });
  }, []);

  // ── Comm devices: RS232 + TCP/IP ───────────────────────────
  useEffect(() => {
    const getConnection = (dev, type) => {
      if (!dev) return "";

      if (type === "TCP") {
        const ip =
          dev.ip ??
          dev.IP ??
          dev["IP Address"] ??
          dev.host ??
          "";
        const port =
          dev.port ??
          dev.Port ??
          "";

        return ip && port ? `${ip}:${port}` : ip || "";
      }

      // RS232 / COM
      return (
        dev.com_port ??
        dev["COM Port"] ??
        dev.comPort ??
        dev.port ??
        dev.Port ??
        dev.com ??
        dev.COM ??
        ""
      );
    };

    const check = async () => {
      try {
        const [rs232Res, tcpStatusRes, tcpDevicesRes] =
          await Promise.all([
            fetch(`${API}/api/comm-status`),
            fetch(`${API}/api/tcp/status`),
            fetch(`${API}/api/tcp/devices`)
          ]);

        const rs232Data = rs232Res.ok
          ? await rs232Res.json()
          : { devices: [] };

        const tcpStatus = tcpStatusRes.ok
          ? await tcpStatusRes.json()
          : {};

        const tcpDeviceData = tcpDevicesRes.ok
          ? await tcpDevicesRes.json()
          : { devices: [] };

        // RS232 devices.
        // Keep every property returned by /api/comm-status so that
        // COM information is preserved when the backend provides it.
        const rs232Devices = (rs232Data.devices || []).map(dev => ({
          name: dev.name ?? dev["Device Name"] ?? "RS232",
          type: "RS232",
          connected: !!dev.connected,
          connection: getConnection(dev, "RS232")
        }));

        // TCP device configuration comes from setting.json through
        // /api/tcp/devices, while connection state comes from
        // /api/tcp/status.
        const configuredTcpDevices = tcpDeviceData.devices || [];

        const tcpDevices = configuredTcpDevices.map(dev => {
          const name = dev.name ?? dev["Device Name"] ?? "TCP";
          const status = tcpStatus[name] || {};

          return {
            name,
            type: "TCP",
            connected: !!status.connected,
            connection: getConnection(
              {
                ...dev,
                ip: status.ip ?? dev.ip,
                port: status.port ?? dev.port
              },
              "TCP"
            )
          };
        });

        // Also keep a TCP device if it exists in status but is not yet
        // returned by /api/tcp/devices.
        const configuredNames = new Set(
          tcpDevices.map(dev => dev.name)
        );

        Object.entries(tcpStatus).forEach(([name, status]) => {
          if (configuredNames.has(name)) return;

          tcpDevices.push({
            name,
            type: "TCP",
            connected: !!status?.connected,
            connection: getConnection(status, "TCP")
          });
        });

        const newDevices = [
          ...rs232Devices,
          ...tcpDevices
        ];

        setCommDevices(prev =>
          JSON.stringify(prev) === JSON.stringify(newDevices)
            ? prev
            : newDevices
        );
      } catch (err) {
        console.error(
          "[COMM DEVICE] Failed to load device status:",
          err
        );
      }
    };

    check();

    const t = setInterval(check, 3000);

    return () => clearInterval(t);
  }, []);

  // ── RS232 Scanner polling ─────────────────────────────────
  // 🟢 Aktifkan polling saat halaman Main aktif dan cpNumber tersedia
  const cpNumber = processCode.replace(/[^0-9]/g, "");
  const isCpActive = activeMenu === "Main" && !!cpNumber;
  // RS232 Scanner
  useRS232Scanner(cpNumber, isCpActive);

  // TCP/IP PLC
  useTCPPLC(cpNumber, isCpActive);

  // ── Helpers ───────────────────────────────────────────────
  const fmtTime = d => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtDate = d => d.toLocaleDateString("en-US", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });
  const fmtWW = d => {
    const start = new Date(d.getFullYear(), 0, 1);
    return `WW${Math.ceil(((d - start) / 86400000 + start.getDay() + 1) / 7)}`;
  };

  const isEngineer = String(user.role || "").toUpperCase() === "ENGINEER";

  // ── Machine status ────────────────────────────────────────
  const machineStatusConfig = {
    "IDLE": { dot: "bg-[#CBD5E1]", label: "⚪ IDLE", color: "#CBD5E1" },
    "RUNNING": { dot: "bg-[#22C55E]", label: "🟢 RUNNING", color: "#22C55E" },
    "MACHINE DOWN": { dot: "bg-[#EF4444]", label: "🔴 MACHINE DOWN", color: "#EF4444" },
    "WAITING MATERIAL": { dot: "bg-[#F59E0B]", label: "🟡 WAITING MATERIAL", color: "#F59E0B" },
  };
  const msConf = machineStatusConfig[machineStatus] || machineStatusConfig["IDLE"];

  // ── Handler untuk pilihan downtime ──────────────────────────
  const handleDowntimeSelect = async (type) => {
    setShowDowntime(false);
    if (downtimeLoading) return;

    setDowntimeLoading(true);
    try {
      const downtimeType = type === "maintenance" ? "MACHINE DOWN" : "WAITING MATERIAL";
      const payload = {
        technician: user?.username || "system",
        shift: "Shift A",
        machine_code: cpInfo.code || "CP2-PCBAVM3",
        downtime_type: downtimeType,
      };

      const res = await fetch(`${API}/api/maintenance/downtime/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (data.success) {
        const start = new Date(data.start_time);
        setDowntimeActive(true);
        setDowntimeStart(start);
        setDowntimeId(data.downtime_id);
        setMachineStatus(downtimeType);
      } else {
        alert(`Gagal memulai downtime: ${data.message || "Unknown error"}`);
      }
    } catch (err) {
      alert(`Error: ${err.message}`);
    } finally {
      setDowntimeLoading(false);
    }
  };

  const refreshCommDevices = async () => {
    try {
      const [rs232Res, tcpStatusRes, tcpDevicesRes] =
        await Promise.all([
          fetch(`${API}/api/comm-status`),
          fetch(`${API}/api/tcp/status`),
          fetch(`${API}/api/tcp/devices`)
        ]);

      const rs232Data = rs232Res.ok
        ? await rs232Res.json()
        : { devices: [] };

      const tcpStatus = tcpStatusRes.ok
        ? await tcpStatusRes.json()
        : {};

      const tcpDeviceData = tcpDevicesRes.ok
        ? await tcpDevicesRes.json()
        : { devices: [] };

      const getCom = dev =>
        dev?.com_port ??
        dev?.["COM Port"] ??
        dev?.comPort ??
        dev?.port ??
        dev?.Port ??
        dev?.com ??
        dev?.COM ??
        "";

      const getTcp = (dev, status = {}) => {
        const ip =
          status.ip ??
          status.IP ??
          dev?.ip ??
          dev?.IP ??
          dev?.["IP Address"] ??
          dev?.host ??
          "";

        const port =
          status.port ??
          status.Port ??
          dev?.port ??
          dev?.Port ??
          "";

        return ip && port ? `${ip}:${port}` : ip || "";
      };

      const rs232Devices = (rs232Data.devices || []).map(dev => ({
        name: dev.name ?? dev["Device Name"] ?? "RS232",
        type: "RS232",
        connected: !!dev.connected,
        connection: getCom(dev)
      }));

      const tcpDevices = (tcpDeviceData.devices || []).map(dev => {
        const name = dev.name ?? dev["Device Name"] ?? "TCP";
        const status = tcpStatus[name] || {};

        return {
          name,
          type: "TCP",
          connected: !!status.connected,
          connection: getTcp(dev, status)
        };
      });

      const configuredNames = new Set(
        tcpDevices.map(dev => dev.name)
      );

      Object.entries(tcpStatus).forEach(([name, status]) => {
        if (configuredNames.has(name)) return;

        tcpDevices.push({
          name,
          type: "TCP",
          connected: !!status?.connected,
          connection: getTcp({}, status)
        });
      });

      setCommDevices([
        ...rs232Devices,
        ...tcpDevices
      ]);
    } catch (err) {
      console.error(
        "[COMM DEVICE] Failed to refresh devices:",
        err
      );
    }
  };

  // ── Relogin handler ────────────────────────────────────────
  const handleReloginSuccess = (userData) => {
    setUser(userData);
  };

  // ── Render konten berdasarkan menu aktif ───────────────────
  const renderContent = () => {
    switch (activeMenu) {
      case "Main":
        if (processCode && cpNumber) {
          return <DynamicCPPage user={user} cpNumber={cpNumber} />;
        }
        return <MainContent />;

      case "Maintenance":
        return (
          <MaintenancePage
            user={user}
            machineStatus={machineStatus}
            downtimeActive={downtimeActive}
            downtimeStart={downtimeStart}
            downtimeId={downtimeId}
            onStatusChange={(status) => setMachineStatus(status)}
            onDowntimeStart={(start, id) => {
              setDowntimeActive(true);
              setDowntimeStart(start);
              setDowntimeId(id);
            }}
            onDowntimeEnd={() => {
              setDowntimeActive(false);
              setDowntimeStart(null);
              setDowntimeId(null);
              setMachineStatus("IDLE");
            }}
          />
        );
      case "SN List": return <SNListPage user={user} />;
      case "Reference": return <ReferencePage user={user} />;
      default:
        return <MainContent />;
    }
  };

  // ── Menu items ─────────────────────────────────────────────
  const settingMenuItems = [
    { icon: <IconInterlock />, label: "Interlock", action: () => setShowInterlock(true) },
    "---",
    { icon: <IconSetting2 />, label: "Setting", action: () => setShowSetting(true) },
    { icon: <IconLogic />, label: "Logic Builder", action: () => setShowLogic(true) },
    { icon: <span>🎨</span>, label: "Page Builder", action: () => setShowBuilder(true) },


  ];

  const userMenuItems = [
    { icon: <IconKey />, label: "Change Password", action: () => setShowChangePass(true) },
    "---",
    { icon: <IconRefresh />, label: "Relogin", action: () => setShowRelogin(true) },
    "---",
    { icon: <span className="text-[#EF4444]">✕</span>, label: "Logout", action: () => onLogout?.() },
  ];

  return (
    <div className="w-screen h-screen bg-[#0F172A] flex flex-col overflow-hidden font-sans">
      {/* HEADER */}
      <header className="h-[72px] bg-[#111827] border-b border-[#1E293B] flex items-center px-5 shrink-0 z-10">
        <div className="flex items-center gap-2 shrink-0">
          <div className="relative">
            <span className="text-[28px] font-black text-[#22C55E] leading-none tracking-tighter">WIK</span>
            <span className="absolute -top-0.5 -right-2 w-1.5 h-1.5 rounded-full bg-[#22C55E] animate-pulse" />
          </div>
          <div className="ml-2 flex flex-col leading-tight">
            <span className="text-[#E2E8F0] text-[10px]">Technology</span>
            <span className="text-[#E2E8F0] text-[10px]">attuned to Nature</span>
          </div>
        </div>

        {/* Title tengah: Control Point Name */}
        <div className="flex-1 flex flex-col items-center select-none">
          <p className="text-[#22C55E] font-bold text-xl leading-tight">{cpInfo.name}</p>
          <p className="text-[#E2E8F0] text-[10px] font-mono mt-0.5">
            {fmtDate(time)} &nbsp; {fmtTime(time)} &nbsp; {fmtWW(time)}
          </p>
        </div>

        <div className="flex items-center gap-4 shrink-0">
          {/* Line Code & Spec Code */}
          <div className="text-right leading-tight hidden lg:block">
            <p className="text-[#E2E8F0] text-[10px] font-mono">Line Code : {cpInfo.code}</p>
            <p className="text-[#E2E8F0] text-[10px] font-mono">Spec Code : {cpInfo.family}</p>
          </div>
          <div className="w-px h-8 bg-[#1E293B]" />
          <div className="flex flex-col items-center gap-1">
            <p className="text-[10px] font-bold font-mono" style={{ color: msConf.color }}>{msConf.label}</p>
            <button
              onClick={() => setShowDowntime(true)}
              disabled={downtimeLoading}
              className="h-7 px-3 rounded-lg bg-[#DC2626] hover:bg-[#B91C1C] text-white text-[10px] font-bold transition-colors flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>⏸</span> Downtime
            </button>
          </div>
          <div className="w-px h-8 bg-[#1E293B]" />
          <div className="relative" ref={settingBtnRef}>
            <button onClick={() => { setShowSettingMenu(p => !p); setShowUserMenu(false); }} disabled={!isEngineer} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#E2E8F0] hover:text-white hover:bg-[#2563EB] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
              <IconGear />
            </button>
            {showSettingMenu && <DropdownMenu anchorRef={settingBtnRef} items={settingMenuItems} onClose={() => setShowSettingMenu(false)} />}
          </div>
          <div className="relative" ref={userBtnRef}>
            <button onClick={() => { setShowUserMenu(p => !p); setShowSettingMenu(false); }} className="w-8 h-8 rounded-lg flex items-center justify-center text-[#E2E8F0] hover:text-white hover:bg-[#2563EB] transition-colors">
              <IconUser />
            </button>
            {showUserMenu && <DropdownMenu anchorRef={userBtnRef} items={userMenuItems} onClose={() => setShowUserMenu(false)} />}
          </div>
          <div className="leading-tight text-left">
            <p className="text-[#E2E8F0] text-[11px] font-semibold">{user.username}</p>
            <p className="text-[#E2E8F0] text-[10px]">{user.role}</p>
          </div>
        </div>
      </header>

      {/* BODY */}
      <div className="flex flex-1 overflow-hidden">
        {/* SIDEBAR KIRI (selalu tampil) */}
        <aside className="w-[130px] bg-[#111827] border-r border-[#1E293B] flex flex-col shrink-0">
          <nav className="pt-2 flex flex-col gap-0.5">
            {MENU_ITEMS.map(label => {
              const disabled = (label === "Maintenance" || label === "Reference") && !isEngineer;
              const active = activeMenu === label;
              return (
                <button
                  key={label}
                  disabled={disabled}
                  onClick={() => !disabled && setActiveMenu(label)}
                  className={`w-full text-left px-4 py-2.5 text-[11px] font-semibold transition-colors ${active
                    ? "bg-[#16A34A] text-white"
                    : disabled
                      ? "text-[#334155] cursor-not-allowed"
                      : "text-[#94A3B8] hover:bg-[#1E293B] hover:text-[#E2E8F0]"
                    }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>
          <div className="flex-1" />
          {/* COMM DEVICE di sidebar kiri */}
          <div className="mx-2 mb-3 rounded-lg border border-[#334155] overflow-hidden" style={{ background: "#111827" }}>
            <div className="px-3 pt-3 pb-1">
              <p className="text-[#22C55E] text-[9px] font-bold tracking-widest uppercase mb-2">COMM DEVICE</p>
              <div className="flex flex-col gap-1">
                {commDevices.length === 0 && <p className="text-[#E2E8F0] text-[9px] font-mono">No devices</p>}
                {commDevices.map(dev => (
                  <div
                    key={`${dev.type}-${dev.name}`}
                    className="flex items-center gap-1.5 min-w-0"
                    title={dev.connection ? `${dev.name} — ${dev.connection}` : dev.name}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                        dev.connected
                          ? "bg-[#22C55E]"
                          : "bg-[#EF4444]"
                      }`}
                    />

                    <span
                      className={`text-[9px] font-mono truncate ${
                        dev.connected
                          ? "text-[#22C55E]"
                          : "text-[#EF4444]"
                      }`}
                    >
                      {dev.name}
                    </span>

                    {dev.connection && (
                      <span className="ml-auto pl-1 text-[8px] font-mono text-[#64748B] truncate shrink-0 max-w-[88px]">
                        {dev.connection}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="px-3 pb-2 pt-1 border-t border-[#1E293B] mt-1">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dbStatus === null ? "bg-[#64748B] animate-pulse" : dbStatus ? "bg-[#22C55E]" : "bg-[#EF4444]"}`} />
                <span className={`text-[9px] font-mono ${dbStatus === null ? "text-[#64748B]" : dbStatus ? "text-[#22C55E]" : "text-[#EF4444]"}`}>Database</span>
              </div>
            </div>
          </div>
        </aside>

        {/* KONTEN UTAMA + SIDEBAR KANAN (kondisional) */}
        <div className="flex flex-1 overflow-hidden">
          {/* Area konten dinamis */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {renderContent()}
          </div>

          {/* ── SIDEBAR KANAN – hanya tampil saat activeMenu === "Main" ── */}
          {activeMenu === "Main" && (
            <aside className="w-[272px] shrink-0 bg-[#1E293B] border-l border-[#334155] flex flex-col gap-3 p-3 overflow-y-auto">
              <div className="rounded-lg border border-[#334155] flex items-center justify-center h-[200px] shrink-0" style={{ background: "#172132" }}>
                <span className="text-[#E2E8F0] text-xs font-mono select-none">[ Product Image ]</span>
              </div>
              <div className="rounded-lg border border-[#334155] p-3 shrink-0" style={{ background: "#1E293B" }}>
                <p className="text-[#E2E8F0] text-[10px] mb-2">Move Status :</p>
                <div className="h-9 rounded-md" style={{ background: "#172132" }} />
              </div>
              <div className="rounded-lg border border-[#334155] flex-1 flex flex-col overflow-hidden" style={{ background: "#1E293B" }}>
                <div className="px-3 pt-2 pb-1 border-b border-[#334155]">
                  <p className="text-[#E2E8F0] text-[10px] font-semibold">Repair Action From Diagnosing</p>
                </div>
                <div className="flex-1 overflow-y-auto">
                  <div className="flex items-center justify-center h-full py-6">
                    <p className="text-[#E2E8F0] text-[10px] font-mono">No data</p>
                  </div>
                </div>
              </div>
              <button className="w-full h-14 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-base transition-colors active:scale-[0.98] shrink-0">
                SN Reject
              </button>
              {/* 🟢 PERBAIKAN: Tombol Reset dengan onClick */}
              <button
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("cp-reset"));
                }}
                className="w-full h-14 rounded-xl bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] font-bold text-base transition-colors active:scale-[0.98] shrink-0"
              >
                Reset
              </button>
            </aside>
          )}
        </div>
      </div>

      {/* ── MODALS ───────────────────────────────────────────── */}
      {showDowntime && <DowntimeModal onClose={() => setShowDowntime(false)} onSelect={handleDowntimeSelect} />}
      {showChangePass && <ChangePasswordModal user={user} onClose={() => setShowChangePass(false)} />}
      {showInterlock && <InterlockModal open={showInterlock} onClose={() => setShowInterlock(false)} />}
      {showSetting && <SettingModal onClose={() => setShowSetting(false)} onSaved={refreshCommDevices} />}
      {showRelogin && <ReloginModal onClose={() => setShowRelogin(false)} onLoginSuccess={handleReloginSuccess} />}

      {/* Page Builder – kirim cpNumber yang benar */}
      {showBuilder && (<PageBuilder
          cpNumber={cpNumber || "2"}
          availableDevices={commDevices}
          onClose={() => setShowBuilder(false)}
        />)}
      {showLogic && (<LogicBuilder cpNumber={cpNumber || "2"} onClose={() => setShowLogic(false)} />)}
    </div>
  );
}

// ── Placeholder pages ──────────────────────────────────────────
function MainContent() {
  return (
    <div className="flex-1 flex items-center justify-center text-[#E2E8F0] font-mono text-sm select-none">
      <div className="text-center">
        <div className="text-4xl mb-3 opacity-20">⚙</div>
        <p>CP02-PCBAVM2 — Main Process</p>
      </div>
    </div>
  );
}