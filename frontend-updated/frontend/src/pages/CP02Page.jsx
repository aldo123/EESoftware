// src/modal/CP02Page.jsx
import { useState, useEffect, useRef, useCallback } from "react";
import { API } from "../service/api";

// ── Icons ──────────────────────────────────────────────────────
const IconReset = () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><polyline points="23 20 23 14 17 14"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10"/><path d="M3.51 15A9 9 0 0 0 18.36 18.36L23 14"/></svg>;

// ── Wrapper Card Component ──────────────────────────────────
function Card({ title, children, className = "" }) {
  return (
    <div className={`bg-[#1E293B] border border-[#334155] rounded-lg p-3 ${className}`}>
      <p className="text-[#94A3B8] text-[10px] font-bold mb-2 tracking-wider uppercase">{title}</p>
      {children}
    </div>
  );
}

// ── MAIN COMPONENT ──────────────────────────────────────────
export default function CP02Page({ user }) {
  // ── State ──────────────────────────────────────────────────
  const [serialNumber, setSerialNumber] = useState("");
  const [feedingMaterial, setFeedingMaterial] = useState("");
  const [materialScanned, setMaterialScanned] = useState(false);
  const [instruction, setInstruction] = useState("Please Scan Product SN");
  const [messageLog, setMessageLog] = useState([]);
  
  // Data Object dari Material (Mapping Matrix)
  const [materialData, setMaterialData] = useState({
    PN: "", Vendor: "", Voltage: "", "HW Ver": "",
    "FW Ver": "", "ESP FW": "", Date: "", "Serial Number": ""
  });

  // Data Table (P/N, Description, Barcode, BT MAC)
  const [tableRows, setTableRows] = useState([]);

  // ── Helper: Add Log ────────────────────────────────────────
  const addLog = useCallback((message, color = "#00FF88") => {
    const timestamp = new Date().toLocaleTimeString("en-US", { hour12: false });
    setMessageLog(prev => [...prev, { timestamp, message, color }]);
  }, []);

  // ── Fetch Settings on Mount ──────────────────────────────
  useEffect(() => {
    // Optional: Pre-fetch settings/validation rules if needed
  }, []);

  // ── Reset Function ─────────────────────────────────────────
  const resetInterlock = useCallback(() => {
    setSerialNumber("");
    setFeedingMaterial("");
    setMaterialScanned(false);
    setInstruction("Please Scan Product SN");
    setTableRows([]);
    setMaterialData({ PN: "", Vendor: "", Voltage: "", "HW Ver": "", "FW Ver": "", "ESP FW": "", Date: "", "Serial Number": "" });
    addLog("System reset successfully.", "#00BFFF");
  }, [addLog]);

  // ── 1. Scan Product SN ──────────────────────────────────────
  const scanProduct = useCallback((sn) => {
    if (serialNumber) {
      addLog(`Product SN already scanned : ${serialNumber}`, "#EAB308");
      return;
    }
    setSerialNumber(sn);
    setInstruction("Please Scan Main PCBA SN");
    addLog(`Product SN scanned : ${sn}`, "#00BFFF");
  }, [serialNumber, addLog]);

  // ── 2. Scan Material SN ──────────────────────────────────────
  const scanMaterial = useCallback(async (materialSn) => {
    if (!serialNumber) {
      addLog("Scan Product SN first", "#EF4444");
      return;
    }

    // Validasi ke Backend
    try {
      const res = await fetch(`${API}/api/cp02/validate-material`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ product_sn: serialNumber, material_sn: materialSn })
      });
      const data = await res.json();

      addLog(`Required Voltage : ${data.required_voltage}`, "#00BFFF");
      addLog(`Material Voltage : ${data.material_voltage}`, "#00BFFF");

      if (!data.match) {
        setInstruction(`PCBA difference voltage please re-scan PCBA (${data.required_voltage})`);
        return;
      }

      if (feedingMaterial) {
        addLog(`Material already scanned : ${feedingMaterial}`, "#EAB308");
        return;
      }

      setFeedingMaterial(materialSn);
      
      // Ambil data parsing Mapping Matrix
      const parseRes = await fetch(`${API}/api/cp02/parse-material`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material_sn: materialSn })
      });
      const parsed = await parseRes.json();
      
      // Mapping ke State Tabel & PCBA Field
      setMaterialData(parsed);
      setTableRows([[
        parsed.PN || "",
        `Main PCBA (${parsed.Voltage || ""})`,
        materialSn,
        "" // Mac Address placeholder
      ]]);

      setMaterialScanned(true);
      setInstruction("Scan Mac Address");
      addLog(`Material scanned successfully.`, "#22C55E");

    } catch (err) {
      addLog(`Error validating material: ${err.message}`, "#EF4444");
    }
  }, [serialNumber, feedingMaterial, addLog]);

  // ── 3. Update MAC Address ────────────────────────────────────
  const updateMacAddress = useCallback((macAddress) => {
    if (!materialScanned) return;
    setTableRows(prev => {
      if (prev.length === 0) return prev;
      const newRows = [...prev];
      newRows[0][3] = macAddress;
      return newRows;
    });
    setInstruction("PASS");
    addLog(`MAC Address : ${macAddress}`, "#22C55E");
  }, [materialScanned, addLog]);

  // ── Handler Mock Serial (Untuk Demo, nanti diganti dengan RS232 Listener) ──
  const handleMockScan = (type) => {
    if (type === "product") scanProduct("SN" + Math.floor(Math.random() * 100000));
    else if (type === "part" && !materialScanned) scanMaterial("MT" + Math.floor(Math.random() * 100000));
    else if (type === "part" && materialScanned) updateMacAddress("MAC:" + Math.floor(Math.random() * 999999));
  };

  // ── Render ──────────────────────────────────────────────────
  return (
    <div className="flex flex-1 bg-[#0F172A] overflow-hidden font-sans p-3 gap-3 min-h-0">
      
      {/* ── KONTEN UTAMA (KIRI) ────────────────────────────────── */}
      <div className="flex-1 flex flex-col gap-3 overflow-hidden min-h-0">

        {/* 1. Serial Number */}
        <Card title="Serial Number :">
          <div className="flex flex-wrap items-center gap-3 mt-1">
            <div className="flex items-center bg-[#172132] border border-[#334155] rounded-lg px-3 h-9 flex-1 min-w-[200px]">
              <span className="text-[#94A3B8] mr-2 font-mono text-sm">▐▌▐▌▐▌</span>
              <input 
                value={serialNumber}
                readOnly
                placeholder="Scan Product SN"
                className="flex-1 bg-transparent text-white text-sm outline-none placeholder-[#334155]"
              />
            </div>
            <div className="flex items-center gap-2 ml-auto">
              <span className="text-[#94A3B8] text-[10px]">Shift Completed Qty :</span>
              <input disabled value="" className="w-16 h-8 bg-[#172132] border border-[#334155] rounded text-white text-xs px-2 outline-none opacity-70" />
              <span className="text-[#94A3B8] text-[10px] ml-2">Pass1 :</span>
              <input disabled className="w-14 h-8 bg-[#172132] border border-[#334155] rounded text-[#22C55E] text-xs text-center outline-none opacity-70" />
              <span className="text-[#94A3B8] text-[10px] ml-2">FPY1 :</span>
              <input disabled className="w-14 h-8 bg-[#172132] border border-[#334155] rounded text-[#22C55E] text-xs text-center outline-none opacity-70" />
              <span className="text-[#94A3B8] text-[10px] ml-2">Pass2 :</span>
              <input disabled className="w-14 h-8 bg-[#172132] border border-[#334155] rounded text-[#22C55E] text-xs text-center outline-none opacity-70" />
              <span className="text-[#94A3B8] text-[10px] ml-2">FPY2 :</span>
              <input disabled className="w-14 h-8 bg-[#172132] border border-[#334155] rounded text-[#22C55E] text-xs text-center outline-none opacity-70" />
            </div>
          </div>
        </Card>

        {/* 2. Production Order */}
        <Card title="Production Order :">
          <div className="flex items-center gap-3 mt-1">
            <div className="flex items-center bg-[#172132] border border-[#334155] rounded-lg px-3 h-9 w-72">
              <span className="text-[#94A3B8] mr-2">📄</span>
              <input disabled placeholder="" className="flex-1 bg-transparent text-white text-sm outline-none opacity-70" />
            </div>
            {["Product :", "Description :", "Order Qty :", "Completed Qty :", "Balance Qty :"].map((label) => (
              <div key={label} className="flex items-center gap-2">
                <span className="text-[#94A3B8] text-[10px] font-bold whitespace-nowrap">{label}</span>
                <input disabled className="w-24 h-8 bg-[#172132] border border-[#334155] rounded text-white text-xs px-2 outline-none opacity-70" />
              </div>
            ))}
          </div>
        </Card>

        {/* 3. Feeding Material */}
        <Card title="Feeding Material :">
          <div className="flex items-center bg-[#172132] border border-[#334155] rounded-lg px-3 h-10 mt-1 w-full">
            <span className="text-[#94A3B8] mr-2 font-mono text-sm">▐▌▐▌▐▌</span>
            <input 
              value={feedingMaterial}
              readOnly
              placeholder="Scan Material Batch / Serial Number"
              className="flex-1 bg-transparent text-white text-sm outline-none placeholder-[#334155]"
            />
          </div>
        </Card>

        {/* 4. P/N Table */}
        <Card title="P/N Table" className="flex-1 flex flex-col overflow-hidden min-h-0 border-b-0">
          <div className="flex-1 overflow-auto mt-1">
            <table className="w-full text-xs border-collapse">
              <thead className="bg-[#111827] text-[#E2E8F0] sticky top-0 z-10">
                <tr>
                  <th className="text-left p-2 border-b border-[#334155]">P/N</th>
                  <th className="text-left p-2 border-b border-[#334155]">Description</th>
                  <th className="text-left p-2 border-b border-[#334155]">Barcode</th>
                  <th className="text-left p-2 border-b border-[#334155]">Bluetooth MAC Address</th>
                </tr>
              </thead>
              <tbody>
                {tableRows.map((row, idx) => (
                  <tr key={idx} className="border-b border-[#1E293B] bg-[#172132]">
                    <td className="p-2 text-white">{row[0]}</td>
                    <td className="p-2 text-white">{row[1]}</td>
                    <td className="p-2 text-white font-mono">{row[2]}</td>
                    <td className="p-2 text-[#22C55E] font-mono">{row[3] || "—"}</td>
                  </tr>
                ))}
                {tableRows.length === 0 && (
                  <tr><td colSpan={4} className="p-6 text-center text-[#475569]">No material scanned.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* 5. PCBA Barcode */}
        <Card title="PCBA Barcode" className="shrink-0">
          <div className="flex flex-wrap gap-2 mt-1">
            {["📄", "👥", "🔌", "🖥", "⬛", "📦", "⊞", "▐▌▐"].map((icon, idx) => {
              const keys = ["PN", "Vendor", "Voltage", "HW Ver", "FW Ver", "ESP FW", "Date", "Serial Number"];
              return (
                <div key={idx} className="flex items-center bg-[#172132] border border-[#334155] rounded px-2 py-1 h-8">
                  <span className="text-[#94A3B8] mr-1 text-sm">{icon}</span>
                  <input 
                    readOnly 
                    value={materialData[keys[idx]] || ""}
                    className="w-20 bg-transparent text-white text-xs outline-none"
                  />
                </div>
              );
            })}
          </div>
        </Card>

        {/* 6. Instruction */}
        <div className="bg-[#172132] border border-[#334155] rounded-lg h-14 flex items-center px-5 shrink-0">
          <span className="text-2xl mr-3">🧑‍💻</span>
          <span className={`font-bold text-lg ${instruction === "PASS" ? "text-[#22C55E]" : "text-[#3B82F6]"}`}>
            {instruction}
          </span>
        </div>

        {/* 7. Message Log */}
        <Card title="Message" className="flex-1 flex flex-col overflow-hidden min-h-0">
          <div className="flex-1 bg-[#0A0F1A] border border-[#111827] rounded p-2 overflow-y-auto custom-scrollbar font-mono text-xs">
            {messageLog.map((log, idx) => (
              <div key={idx} style={{ color: log.color }}>
                [{log.timestamp}] {log.message}
              </div>
            ))}
            {messageLog.length === 0 && <div className="text-[#475569]">Waiting for actions...</div>}
          </div>
        </Card>

      </div>
      
      <style>{`
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: #0A0F1A; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #3B82F6; border-radius: 4px; }
      `}</style>
    </div>
  );
}