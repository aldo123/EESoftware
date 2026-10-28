// src/lib/perfMonitor.js
// Optional diagnostic. Enable in DevTools console:  localStorage.setItem("ee_perf", "1")  then restart.
// Prints "[Perf] long task N ms" whenever the UI thread was blocked for more than 80 ms.
try {
  if (typeof window !== "undefined" && window.localStorage?.getItem("ee_perf") === "1" && "PerformanceObserver" in window) {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.duration > 80) console.warn(`[Perf] long task ${Math.round(e.duration)} ms`);
      }
    }).observe({ entryTypes: ["longtask"] });
  }
} catch {
  /* diagnostics must never break the app */
}
