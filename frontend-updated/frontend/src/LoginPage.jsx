import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import InterlockModal from "./modal/InterlockModal";
import factory from "./assets/factory.png";
import { API } from "./service/api";
import { EASE_OUT } from "./components/motion";

const IconCard = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>);
const IconUser = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>);
const IconLock = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>);
const IconEye = ({ open }) => open ? (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>) : (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>);
const IconSettings = () => (<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>);
const IconDB = () => (
<svg
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
>
    <ellipse cx="12" cy="5" rx="8" ry="3"/>
    <path d="M4 5v14"/>
    <path d="M20 5v14"/>
    <path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3"/>
    <path d="M4 19c0 1.7 3.6 3 8 3s8-1.3 8-3"/>
</svg>
);



export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState("card");
  const [cardVal, setCardVal] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [dbStatus, setDbStatus] = useState(null);
  const [time, setTime] = useState(new Date());
  const [showSettings, setShowSettings] = useState(false);
  const cardRef = useRef(null);

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let p = 0;
    const t = setInterval(() => {
      p += 1; setProgress(p);
      if (p >= 100) { clearInterval(t); setReady(true); }
    }, 22);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const check = () => {
      fetch(`${API}/api/health`)
        .then(r => r.json())
        .then(d => setDbStatus(d.db_connected))
        .catch(() => setDbStatus(false));
    };
    check();
    const t = setInterval(check, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (ready && mode === "card" && cardRef.current) cardRef.current.focus();
  }, [ready, mode]);

  const doLogin = async () => {
  if (!ready) return;
  setError(""); setLoading(true);
  try {
    if (mode === "card") {
      if (!cardVal.trim()) { setError("Please scan your card"); setLoading(false); return; }
      const r = await fetch(`${API}/api/login/card`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_card: cardVal })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Login failed");
      
      // ✅ Panggil onLogin dengan data user
      onLogin(d.user);   // d.user = { username, role, ... }
      
    } else {
      // password mode
      if (!username.trim() || !password.trim()) {
        setError("Enter username and password");
        setLoading(false);
        return;
      }
      const r = await fetch(`${API}/api/login/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || "Login failed");
      
      // ✅ Panggil onLogin dengan data user
      onLogin(d.user);
    }
  } catch (e) {
    setError(e.message);
  }
  setLoading(false);
};

  const fmtTime = d => d.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const fmtDate = d => d.toLocaleDateString("en-US", { weekday: "long", day: "2-digit", month: "long", year: "numeric" });

  return (
    <div className="min-h-screen bg-[var(--bg-app)] flex items-center justify-center font-sans transition-colors">
      <motion.div
        className="w-[1320px] h-[700px] flex rounded-2xl overflow-hidden border border-[var(--border-soft)] shadow-2xl"
        initial={{ opacity: 0, scale: 0.97, y: 16 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.45, ease: EASE_OUT }}
      >

        {/* LEFT */}
        <div className="relative flex-1 bg-[#030712] overflow-hidden">
          <div className="absolute inset-0" style={{ backgroundImage: `url(${factory})`, backgroundSize: "cover", backgroundPosition: "center", filter: "brightness(0.35)" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to right, rgba(3,7,18,0.3) 0%, rgba(3,7,18,0.75) 100%)" }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(3,7,18,0.9) 0%, transparent 40%)" }} />
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: "linear-gradient(#22C55E 1px, transparent 1px), linear-gradient(90deg, #22C55E 1px, transparent 1px)", backgroundSize: "40px 40px" }} />
          <div className="absolute top-0 left-0 w-48 h-48 rounded-br-full opacity-10" style={{ background: "radial-gradient(circle at top left, #22C55E, transparent 70%)" }} />

          <div className="absolute inset-0 flex flex-col items-center justify-center select-none">
            <div className="text-center">
              <p className="text-3xl font-mono font-bold text-[#22C55E] tabular-nums drop-shadow-lg">{fmtTime(time)}</p>
              <p className="text-[#94A3B8] text-sm mt-1 font-mono">{fmtDate(time)}</p>
            </div>
          </div>

          <div className="absolute bottom-0 left-0 right-0 bg-[#0F172A]/80 backdrop-blur-sm border-t border-[#1E293B]">
            <div className="h-1 bg-[#1E293B]">
              <div className="h-full bg-[#22C55E] transition-all duration-75" style={{ width: `${progress}%` }} />
            </div>
            <div className="flex items-center justify-between px-5 py-2.5">
              <p className={`text-xs font-mono transition-colors ${ready ? "text-[#22C55E]" : "text-[#475569]"}`}>
                {ready ? "✓  System Ready" : `System Loading…  ${progress}%`}
              </p>
              <p className="text-[#334155] text-xs font-mono">EE — Interlock & Traceability v1.0.0.1008</p>
            </div>
          </div>
        </div>

        {/* RIGHT */}
        <div className="w-[400px] bg-[var(--bg-surface)] border-l border-[var(--border-soft)] flex flex-col transition-colors">
          <div className="flex justify-end px-4 pt-3">
            <button className="w-8 h-8 rounded-lg flex items-center justify-center text-[#EF4444]/60 hover:text-[#EF4444] hover:bg-[#7F1D1D]/30 transition-colors text-sm font-bold">✕</button>
          </div>

          <div className="flex flex-col items-center pt-2 pb-4 px-10">
            <div className="relative mb-1">
              <span className="text-[52px] font-black text-[#22C55E] leading-none tracking-tighter">WIK</span>
              <span className="absolute -top-1 -right-3 w-2 h-2 rounded-full bg-[#22C55E] animate-pulse" />
            </div>
            <p className="text-[var(--text-muted)] text-xs tracking-widest uppercase font-mono">Technology · attuned to Nature</p>
            <div className="w-full h-px bg-[var(--border-soft)] my-4" />
            <p className="text-[var(--text-secondary)] text-sm font-medium">EE — Interlock & Traceability</p>
          </div>

          <div className="px-8 mb-1">
            <div className="flex bg-[var(--bg-surface-2)] rounded-xl p-1 border border-[var(--border-soft)]">
              <button onClick={() => { setMode("card"); setError(""); }}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${mode === "card" ? "bg-[#22C55E] text-[#052E16]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
                <IconCard /> Card Scan
              </button>
              <button onClick={() => { setMode("password"); setError(""); }}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all flex items-center justify-center gap-1.5 ${mode === "password" ? "bg-[#22C55E] text-[#052E16]" : "text-[var(--text-muted)] hover:text-[var(--text-secondary)]"}`}>
                <IconLock /> Password
              </button>
            </div>
          </div>

          <div className="px-8 mt-5 flex flex-col gap-3">
            <AnimatePresence mode="wait" initial={false}>
              {mode === "card" ? (
                <motion.div
                  key="card"
                  initial={{ opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ duration: 0.15, ease: EASE_OUT }}
                >
                  <Field icon={<IconCard />} placeholder="Scan card number…" value={cardVal} onChange={e => setCardVal(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} inputRef={cardRef} autoFocus />
                </motion.div>
              ) : (
                <motion.div
                  key="password"
                  className="flex flex-col gap-3"
                  initial={{ opacity: 0, x: 8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -8 }}
                  transition={{ duration: 0.15, ease: EASE_OUT }}
                >
                  <Field icon={<IconUser />} placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
                  <Field icon={<IconLock />} placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && doLogin()} type={showPass ? "text" : "password"}
                    suffix={<button type="button" onClick={() => setShowPass(p => !p)} className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] transition-colors p-1"><IconEye open={showPass} /></button>} />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence>
              {error && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18, ease: EASE_OUT }}
                  className="flex items-center gap-2 bg-[#7F1D1D]/30 border border-[#EF4444]/30 rounded-lg px-3 py-2.5 overflow-hidden"
                >
                  <span className="text-[#EF4444] text-xs">⚠</span>
                  <p className="text-[#FCA5A5] text-xs">{error}</p>
                </motion.div>
              )}
            </AnimatePresence>

            <button onClick={doLogin} disabled={!ready || loading}
              className="w-full py-3 rounded-xl font-bold text-sm bg-[#22C55E] hover:bg-[#16A34A] text-[#052E16] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 active:scale-[0.98] mt-1">
              {loading ? (<><div className="w-4 h-4 border-2 border-[#052E16] border-t-transparent rounded-full animate-spin" /> Authenticating…</>) : !ready ? "Loading…" : "Login"}
            </button>
          </div>

          <div className="px-8 pb-5 pt-4 mt-auto">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <span className={`w-1.5 h-1.5 rounded-full ${dbStatus === null ? "bg-[#64748B] animate-pulse" : dbStatus ? "bg-[#22C55E]" : "bg-[#EF4444]"}`} />
                <div className="flex items-center gap-2">
                      <div
                          className={`
                              w-8 h-8 rounded-lg
                              flex items-center justify-center
                              ${dbStatus
                                  ? "bg-green-500/15 text-green-400"
                                  : "bg-red-500/15 text-red-400"}
                          `}
                      >
                          <IconDB />
                      </div>

                      <span
                          className={`
                              text-sm font-semibold
                              ${dbStatus ? "text-green-400" : "text-red-400"}
                          `}
                      >
                          {dbStatus ? "Connected" : "Disconnected"}
                      </span>
                  </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[var(--text-faint)] text-xs font-mono">v1.0.0.1008</span>
                <button onClick={() => setShowSettings(true)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-elevated)] transition-colors">
                  <IconSettings />
                </button>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      <AnimatePresence>
        {showSettings && <InterlockModal onClose={() => setShowSettings(false)} onSaved={connected => setDbStatus(connected)} />}
      </AnimatePresence>
    </div>
  );
}

function Field({ icon, placeholder, value, onChange, onKeyDown, type = "text", suffix, inputRef, autoFocus }) {
  return (
    <div className="flex items-center bg-[var(--bg-input)] border border-[var(--border-soft)] focus-within:border-[#22C55E]/60 rounded-xl px-3 h-11 gap-2.5 transition-colors group">
      <span className="text-[var(--text-muted)] group-focus-within:text-[#22C55E] transition-colors shrink-0">{icon}</span>
      <input ref={inputRef} type={type} placeholder={placeholder} value={value} onChange={onChange} onKeyDown={onKeyDown} autoFocus={autoFocus}
        className="flex-1 bg-transparent text-[var(--text-primary)] text-sm placeholder-[var(--text-faint)] outline-none" />
      {suffix}
    </div>
  );
}