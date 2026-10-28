// electron/external-embed.js
// Launches an external Windows program (C# .NET / built LabVIEW exe, etc.) and
// embeds its main window into the Electron BrowserWindow at a rectangle
// reported by the renderer (ExternalSoftwarePanel).
//
// Requires:  npm i koffi
// Windows only. Untested against your specific exe: validate with it first.

const { ipcMain, dialog, screen } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const log = (...a) => console.log('[External]', ...a);

let koffi = null;
let u32 = null;

function loadWin32() {
  if (u32) return u32;
  if (process.platform !== 'win32') throw new Error('External Software embedding is Windows only.');
  koffi = require('koffi');
  const user32 = koffi.load('user32.dll');
  const gdi32 = koffi.load('gdi32.dll');

  koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  koffi.proto('bool __stdcall WNDENUMPROC(intptr_t hwnd, intptr_t lp)');

  u32 = {
    EnumWindows: user32.func('bool __stdcall EnumWindows(WNDENUMPROC *cb, intptr_t lp)'),
    GetWindowThreadProcessId: user32.func('uint32_t __stdcall GetWindowThreadProcessId(intptr_t hwnd, _Out_ uint32_t *pid)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(intptr_t hwnd)'),
    IsWindow: user32.func('bool __stdcall IsWindow(intptr_t hwnd)'),
    GetWindow: user32.func('intptr_t __stdcall GetWindow(intptr_t hwnd, uint32_t cmd)'),
    GetWindowRect: user32.func('bool __stdcall GetWindowRect(intptr_t hwnd, _Out_ RECT *r)'),
    GetClassNameW: user32.func('int __stdcall GetClassNameW(intptr_t hwnd, void *buf, int max)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(intptr_t hwnd, void *buf, int max)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(intptr_t hwnd, int idx)'),
    SetWindowLongPtrW: user32.func('intptr_t __stdcall SetWindowLongPtrW(intptr_t hwnd, int idx, intptr_t v)'),
    GetClientRect: user32.func('bool __stdcall GetClientRect(intptr_t hwnd, _Out_ RECT *r)'),
    SetWindowRgn: user32.func('int __stdcall SetWindowRgn(intptr_t hwnd, intptr_t rgn, bool redraw)'),
    CreateRectRgn: gdi32.func('intptr_t __stdcall CreateRectRgn(int32_t l, int32_t t, int32_t r, int32_t b)'),
    IsIconic: user32.func('bool __stdcall IsIconic(intptr_t hwnd)'),
    IsZoomed: user32.func('bool __stdcall IsZoomed(intptr_t hwnd)'),
    GetParent: user32.func('intptr_t __stdcall GetParent(intptr_t hwnd)'),
    SetParent: user32.func('intptr_t __stdcall SetParent(intptr_t child, intptr_t parent)'),
    SetWindowPos: user32.func('bool __stdcall SetWindowPos(intptr_t hwnd, intptr_t after, int x, int y, int w, int h, uint32_t flags)'),
    ShowWindow: user32.func('bool __stdcall ShowWindow(intptr_t hwnd, int cmd)'),
    PostMessageW: user32.func('bool __stdcall PostMessageW(intptr_t hwnd, uint32_t msg, intptr_t wp, intptr_t lp)'),
  };
  return u32;
}

// Win32 constants
const GWL_STYLE = -16;
const WS_CHILD = 0x40000000;
const WS_POPUP = 0x80000000;
const WS_CAPTION = 0x00c00000;
const WS_THICKFRAME = 0x00040000;
const WS_MINIMIZEBOX = 0x00020000;
const WS_MAXIMIZEBOX = 0x00010000;
const WS_SYSMENU = 0x00080000;
const GW_OWNER = 4;
const GWL_EXSTYLE = -20;
const GWLP_HWNDPARENT = -8;
const WS_EX_TOOLWINDOW = 0x00000080;
const WS_EX_APPWINDOW = 0x00040000;
const SWP_NOACTIVATE = 0x0010;
const SW_SHOWNOACTIVATE = 4;
const SLOW_WIN32_MS = 50;      // log a warning when moving the program window takes longer
const APPLY_MIN_GAP_MS = 16;   // at most ~60 window updates per second
const HWND_TOP = 0;
const SWP_SHOWWINDOW = 0x0040;
const SWP_FRAMECHANGED = 0x0020;
const SW_HIDE = 0;
const SW_RESTORE = 9;
const WM_CLOSE = 0x0010;

function splitArgs(str) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(str || ''))) out.push(m[1] !== undefined ? m[1] : m[2]);
  return out;
}

function windowTitleOf(hwnd) {
  const w = loadWin32();
  const buf = Buffer.alloc(1024);
  const n = w.GetWindowTextW(hwnd, buf, 512);
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
}

// Pick the biggest visible, un-owned top-level window.
// Match by PID, or (fallback for launcher stubs) by window title substring.
function classOf(hwnd) {
  const w = loadWin32();
  const buf = Buffer.alloc(512);
  const n = w.GetClassNameW(hwnd, buf, 256);
  return n > 0 ? buf.toString('utf16le', 0, n * 2) : '';
}

// Log every top-level window of a process (visible or not): diagnostic aid
function dumpWindows(pid, label) {
  const w = loadWin32();
  const rows = [];
  w.EnumWindows((hwnd) => {
    const owner = [0];
    w.GetWindowThreadProcessId(hwnd, owner);
    if (owner[0] !== pid) return true;
    const r = {};
    w.GetWindowRect(hwnd, r);
    rows.push(
      `  hwnd=${hwnd} class="${classOf(hwnd)}" visible=${w.IsWindowVisible(hwnd)} ` +
      `owner=${w.GetWindow(hwnd, GW_OWNER)} size=${r.right - r.left}x${r.bottom - r.top} title="${windowTitleOf(hwnd)}"`
    );
    return true;
  }, 0);
  log(`windows of pid ${pid} (${label}): ${rows.length ? '\n' + rows.join('\n') : 'none'}`);
}

// Log every visible titled top-level window with its process name (diagnostic aid)
async function dumpAllVisible(label) {
  const w = loadWin32();
  const names = await new Promise((resolve) => {
    execFile('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true }, (err, out) => {
      const map = {};
      if (!err) {
        for (const line of String(out).split(/\r?\n/)) {
          const m = line.match(/^"([^"]+)","(\d+)"/);
          if (m) map[m[2]] = m[1];
        }
      }
      resolve(map);
    });
  });
  const rows = [];
  w.EnumWindows((hwnd) => {
    if (!w.IsWindowVisible(hwnd)) return true;
    const title = windowTitleOf(hwnd);
    if (!title) return true;
    const o = [0];
    w.GetWindowThreadProcessId(hwnd, o);
    if (o[0] === process.pid) return true;
    const r = {};
    w.GetWindowRect(hwnd, r);
    rows.push(
      `  pid=${o[0]} (${names[o[0]] || '?'}) hwnd=${hwnd} class="${classOf(hwnd)}" ` +
      `owner=${w.GetWindow(hwnd, GW_OWNER)} size=${r.right - r.left}x${r.bottom - r.top} title="${title}"`
    );
    return true;
  }, 0);
  log(`all visible windows (${label}):\n${rows.join('\n')}`);
}

function sizeKey(hwnd) {
  const r = {};
  loadWin32().GetWindowRect(hwnd, r);
  return `${r.right - r.left}x${r.bottom - r.top}`;
}

function findMainWindow(pid, titleSubstr) {
  const w = loadWin32();
  const wanted = (titleSubstr || '').trim().toLowerCase();
  let best = 0;
  let bestScore = 0;

  w.EnumWindows((hwnd) => {
    if (!w.IsWindowVisible(hwnd)) return true;
    // Skip dialogs / owned windows, unless the user named the window by title
    if (!wanted && w.GetWindow(hwnd, GW_OWNER) !== 0) return true;

    const owner = [0];
    w.GetWindowThreadProcessId(hwnd, owner);
    if (owner[0] === process.pid) return true; // never grab our own Electron window

    const match = wanted
      ? windowTitleOf(hwnd).toLowerCase().includes(wanted)
      : owner[0] === pid;
    if (!match) return true;

    const r = {};
    w.GetWindowRect(hwnd, r);
    const area = (r.right - r.left) * (r.bottom - r.top);
    if (area < 150 * 100) return true;
    // LabVIEW front panels use window class "LVDChild": prefer them over any other window
    const score = area + (classOf(hwnd) === 'LVDChild' ? 1e9 : 0);
    if (score > bestScore) {
      best = hwnd;
      bestScore = score;
    }
    return true;
  }, 0);

  return best;
}

function describeSpawnError(err, exePath) {
  const code = err?.code || '';
  let msg = `Cannot start "${path.basename(exePath)}": ${err?.message || code}`;
  if (['EACCES', 'EPERM', 'UNKNOWN'].includes(code)) {
    msg += ' (the program may require administrator rights: run this app as administrator, or remove "run as administrator" from the exe)';
  }
  return msg;
}

function registerExternalEmbed({ getWindow, killTree }) {
  let child = null;     // spawned process (launcher-style programs may exit early)
  let childHwnd = 0;    // embedded window
  let childPid = 0;     // process that owns the embedded window (may differ from child.pid)
  let currentKey = '';
  let starting = null;  // in-flight start promise (prevents double spawn)
  let generation = 0;   // bumped on every close; lets an in-flight start notice it was cancelled
  let closeTimer = null;
  let watchTimer = null;
  let stopped = null;   // { message } when the program ended by itself (no auto-restart)
  let lastPosKey = '';
  let lastLayout = null; // { visible, bounds, method } last requested by the panel
  const hooked = new WeakSet();
  let naturalPx = null; // original client size of the program window (physical px)
  let rgnKey = '';
  let lastAppliedKey = '';   // what is currently applied to the program window
  let needFrameChanged = false; // only the first SetWindowPos after the style change needs it
  let lastApplyAt = 0;
  let applyTimer = null;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function notifyStopped(message) {
    stopped = { message };
    clearInterval(watchTimer);
    watchTimer = null;
    childHwnd = 0;
    childPid = 0;
    currentKey = '';
    naturalPx = null;
    rgnKey = '';
    lastAppliedKey = '';
    clearTimeout(applyTimer);
    applyTimer = null;
    log('program stopped by itself:', message);
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('external:stopped', { message });
  }

  function startWatching() {
    clearInterval(watchTimer);
    watchTimer = setInterval(() => {
      try {
        if (childHwnd && !u32.IsWindow(childHwnd)) notifyStopped('The external program closed its own window.');
      } catch { /* ignore */ }
    }, 1000);
  }

  async function closeExternal(reason = 'unspecified') {
    log('closeExternal, reason:', reason);
    generation++;
    clearTimeout(closeTimer);
    clearInterval(watchTimer);
    watchTimer = null;
    stopped = null;
    lastPosKey = '';
    lastLayout = null;
    naturalPx = null;
    rgnKey = '';
    lastAppliedKey = '';
    clearTimeout(applyTimer);
    applyTimer = null;
    const hwnd = childHwnd;
    const pid = childPid || child?.pid;
    child = null;
    childHwnd = 0;
    childPid = 0;
    currentKey = '';
    starting = null;
    try {
      if (hwnd && u32?.IsWindow(hwnd)) u32.PostMessageW(hwnd, WM_CLOSE, 0, 0); // graceful first
    } catch { /* ignore */ }
    if (pid) {
      await sleep(400);
      await killTree(pid); // then make sure the whole tree is gone
    }
  }

  // Position / show / hide the program window according to the last layout
  // reported by the panel. Also re-run when the Electron window moves/resizes/restores.
  function applyLayout() {
    if (!childHwnd || !lastLayout || stopped) return;
    const w = loadWin32();
    const win = getWindow();
    if (!win || win.isDestroyed() || !w.IsWindow(childHwnd)) return;
    const { visible, bounds, method, fit, view, offset, contentPx } = lastLayout;

    if (!visible || !bounds || bounds.width < 2 || bounds.height < 2 || win.isMinimized()) {
      if (w.IsWindowVisible(childHwnd)) w.ShowWindow(childHwnd, SW_HIDE);
      return;
    }

    const nat = contentPx || naturalPx; // override, else the program's original size
    const scrollMode = method === 'overlay' && fit === 'scroll' && !!nat;
    const scale = screen.getDisplayMatching(win.getBounds()).scaleFactor || 1;
    let px;
    let region = null; // visible part of the window, in window coordinates (Scroll mode)

    if (method === 'attach') {
      // child coordinates: relative to the Electron client area, physical pixels
      px = {
        x: Math.round(bounds.x * scale), y: Math.round(bounds.y * scale),
        w: Math.round(bounds.width * scale), h: Math.round(bounds.height * scale),
      };
    } else if (!scrollMode) {
      // Fit: top-level window stretched over the panel (absolute screen pixels)
      const cb = win.getContentBounds();
      const r = screen.dipToScreenRect(win, {
        x: cb.x + bounds.x, y: cb.y + bounds.y, width: bounds.width, height: bounds.height,
      });
      px = { x: r.x, y: r.y, w: r.width, h: r.height };
    } else {
      // Scroll: keep the original size, show only the viewport through a window region
      const v = view || bounds;
      const cb = win.getContentBounds();
      const r = screen.dipToScreenRect(win, {
        x: cb.x + v.x, y: cb.y + v.y, width: v.width, height: v.height,
      });
      const natW = nat.w;
      const natH = nat.h;
      const offX = Math.min(Math.max(0, Math.round((offset?.x || 0) * scale)), Math.max(0, natW - r.width));
      const offY = Math.min(Math.max(0, Math.round((offset?.y || 0) * scale)), Math.max(0, natH - r.height));
      px = { x: r.x - offX, y: r.y - offY, w: natW, h: natH };
      region = {
        l: offX, t: offY,
        r: Math.min(natW, offX + r.width), b: Math.min(natH, offY + r.height),
      };
    }

    const rkey = region ? `${region.l},${region.t},${region.r},${region.b}` : '';
    const posKey = `${method}${scrollMode ? '/scroll' : ''}:${px.x},${px.y},${px.w},${px.h}|${rkey}`;
    const isShown = w.IsWindowVisible(childHwnd);

    // Same place, same size, already visible: do NOT touch the program window.
    // Every SetWindowPos makes the other program recompute and repaint itself (a LabVIEW
    // front panel with graphs is expensive), and this function runs on every resize /
    // focus / move event and on every request of the panel.
    if (posKey === lastAppliedKey && isShown) return;

    const t0 = Date.now();
    if (rkey !== rgnKey) {
      // After SetWindowRgn the system owns the region handle (do not delete it)
      if (region) w.SetWindowRgn(childHwnd, w.CreateRectRgn(region.l, region.t, region.r, region.b), true);
      else w.SetWindowRgn(childHwnd, 0, true);
      rgnKey = rkey;
    }
    if (posKey !== lastPosKey) {
      log(`position css=${JSON.stringify(bounds)} -> ${posKey}`);
      lastPosKey = posKey;
    }
    if (!isShown) w.ShowWindow(childHwnd, SW_SHOWNOACTIVATE);
    w.SetWindowPos(childHwnd, HWND_TOP, px.x, px.y, px.w, px.h,
      SWP_SHOWWINDOW | SWP_NOACTIVATE | (needFrameChanged ? SWP_FRAMECHANGED : 0));
    needFrameChanged = false;
    lastAppliedKey = posKey;

    // Calls into another program can block while ITS window thread is busy.
    const took = Date.now() - t0;
    if (took > SLOW_WIN32_MS) {
      log(`SLOW: moving/showing the program window took ${took} ms (the program was busy; this app waited)`);
    }
  }

  // Layout requests can arrive in bursts (dragging a scrollbar, window events). The program
  // window is updated at most about 60 times per second; the LAST requested layout always wins.
  function requestApply() {
    const wait = APPLY_MIN_GAP_MS - (Date.now() - lastApplyAt);
    if (wait <= 0) {
      clearTimeout(applyTimer);
      applyTimer = null;
      lastApplyAt = Date.now();
      applyLayout();
      return;
    }
    if (!applyTimer) {
      applyTimer = setTimeout(() => {
        applyTimer = null;
        lastApplyAt = Date.now();
        try { applyLayout(); } catch (e) { log('layout update failed:', e?.message || e); }
      }, wait);
    }
  }

  function hookWindow(win) {
    if (hooked.has(win)) return;
    hooked.add(win);
    for (const ev of ['move', 'resize', 'restore', 'show', 'focus']) {
      win.on(ev, () => { try { requestApply(); } catch { /* ignore */ } });
    }
  }

  function validate(exePath) {
    if (typeof exePath !== 'string' || !path.isAbsolute(exePath)) return 'Exe path must be an absolute path.';
    if (path.extname(exePath).toLowerCase() !== '.exe') return 'File must be a .exe';
    if (!fs.existsSync(exePath)) return `File not found: ${exePath}`;
    return null;
  }

  async function start({ exePath, args, windowTitle, method }) {
    const w = loadWin32();
    const win = getWindow();
    if (!win || win.isDestroyed()) throw new Error('Main window is not available.');

    const myGen = generation;
    let spawnError = null;
    let exitInfo = null;
    const cancelled = () => {
      const err = new Error('cancelled');
      err.cancelled = true;
      return err;
    };

    const spawned = spawn(exePath, splitArgs(args), {
      cwd: path.dirname(exePath),
      detached: false,
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child = spawned;
    log(`spawned pid=${spawned.pid} exe=${exePath} args="${args}"`);

    // Keep draining the pipes (a full pipe would block the program) but only
    // remember the first few KB so we can show why it exited.
    let output = '';
    const collect = (d) => {
      if (output.length < 4000) output += String(d);
    };
    spawned.stdout?.on('data', collect);
    spawned.stderr?.on('data', collect);

    let windowFound = false;
    setTimeout(() => {
      if (!windowFound) dumpAllVisible('4 s after spawn, no window matched yet').catch(() => {});
    }, 4000);

    spawned.once('error', (err) => { spawnError = err; });
    spawned.once('exit', (code, signal) => {
      exitInfo = { code, signal };
      log(`process pid=${spawned.pid} exited code=${code} signal=${signal}`);
      if (child === spawned) child = null;
      // After attaching: the program ended by itself -> tell the panel (no auto-restart)
      if (childPid && childPid === spawned.pid && myGen === generation) {
        notifyStopped(
          `The external program exited (exit code ${code ?? signal}).` +
          (output.trim() ? `\n\nProgram output: ${output.trim().slice(0, 600)}` : '')
        );
      }
    });

    // Wait for its main window (up to ~20 s; LabVIEW runtime can start slowly)
    let hwnd = 0;
    let lastKey = '';
    for (let i = 0; i < 225 && !hwnd; i++) {
      await sleep(200);
      if (myGen !== generation) {
        // closeExternal() ran while we were waiting: this process is no longer wanted
        if (spawned.pid) killTree(spawned.pid);
        throw cancelled();
      }
      if (spawnError) throw new Error(describeSpawnError(spawnError, exePath));
      if (exitInfo && !windowTitle) {
        hwnd = findMainWindow(spawned.pid, ''); // last look before giving up
        if (!hwnd) {
          const out = output.trim().slice(0, 600);
          log(`exited before showing a window. code=${exitInfo.code} output=${output.trim()}`);
          throw new Error(
            (out ? `Program output: ${out}\n\n` : '') +
            `The program exited (exit code ${exitInfo.code ?? exitInfo.signal}) before showing a window. ` +
            'If it only launches another process (launcher / single-instance app), fill in "External Window Title". ' +
            'If it only works when started manually, check its required runtime (e.g. LabVIEW Run-Time Engine), ' +
            'working folder or administrator rights.'
          );
        }
        break;
      }
      const candidate = findMainWindow(spawned.pid, windowTitle);
      // Require the same window on two consecutive polls so a splash screen
      // that closes after a moment is not picked by mistake
      // (same window AND same size, so the size we record below is the final one)
      const key = candidate ? `${candidate}:${sizeKey(candidate)}` : '';
      if (candidate && key === lastKey) hwnd = candidate;
      lastKey = key;
    }
    if (!hwnd) {
      try { await dumpAllVisible('timeout, no window matched'); } catch { /* ignore */ }
      throw new Error(
        windowTitle
          ? `No window with title containing "${windowTitle}" appeared within 45 seconds.`
          : 'No window of this program appeared within 45 seconds. If the exe starts another process for its window, set "External Window Title".'
      );
    }

    windowFound = true;
    {
      const r = {};
      w.GetWindowRect(hwnd, r);
      const owner = [0];
      w.GetWindowThreadProcessId(hwnd, owner);
      log(`found window hwnd=${hwnd} ownerPid=${owner[0]} size=${r.right - r.left}x${r.bottom - r.top} title="${windowTitleOf(hwnd)}" class="${classOf(hwnd)}"`);
      dumpWindows(owner[0], 'at attach time');
      setTimeout(() => { try { dumpWindows(owner[0], '3 s later'); } catch { /* ignore */ } }, 3000);
    }

    // Hide first so the user never sees it jump around
    if (w.IsIconic(hwnd) || w.IsZoomed(hwnd)) w.ShowWindow(hwnd, SW_RESTORE);
    w.ShowWindow(hwnd, SW_HIDE);
    {
      // Original client size, used by "Scroll" fit mode
      const cr = {};
      w.GetClientRect(hwnd, cr);
      naturalPx = { w: cr.right - cr.left, h: cr.bottom - cr.top };
      log(`natural client size ${naturalPx.w}x${naturalPx.h}`);
    }

    const ownerOf = [0];
    w.GetWindowThreadProcessId(hwnd, ownerOf);
    childPid = ownerOf[0];

    const parent = Number(win.getNativeWindowHandle().readBigUInt64LE());
    const NO_FRAME = ~(WS_CAPTION | WS_THICKFRAME | WS_SYSMENU | WS_MINIMIZEBOX | WS_MAXIMIZEBOX);
    let style = Number(w.GetWindowLongPtrW(hwnd, GWL_STYLE)) >>> 0;

    if (method === 'attach') {
      // Child window of the Electron window (may be hidden behind Chromium's compositor)
      style = (((style & NO_FRAME & ~WS_POPUP) | WS_CHILD) >>> 0);
      w.SetWindowLongPtrW(hwnd, GWL_STYLE, style);
      w.SetParent(hwnd, parent);
      if (Number(w.GetParent(hwnd)) !== parent) {
        if (spawned.pid) killTree(spawned.pid);
        throw new Error(
          'Could not attach the program window to this app. It may be running with higher privileges ' +
          '(administrator) than this app, or it does not allow being re-parented.'
        );
      }
    } else {
      // Overlay: borderless top-level window OWNED by the Electron window.
      // An owned window stays above its owner, minimizes/restores with it,
      // and does not float above other applications.
      style = (((style & NO_FRAME & ~WS_CHILD) | WS_POPUP) >>> 0);
      w.SetWindowLongPtrW(hwnd, GWL_STYLE, style);
      let ex = Number(w.GetWindowLongPtrW(hwnd, GWL_EXSTYLE)) >>> 0;
      ex = (((ex & ~WS_EX_APPWINDOW) | WS_EX_TOOLWINDOW) >>> 0);
      w.SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex);
      w.SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, parent);
      if (Number(w.GetWindow(hwnd, GW_OWNER)) !== parent) {
        if (spawned.pid) killTree(spawned.pid);
        throw new Error(
          'Could not link the program window to this app (owner). It may be running with higher privileges ' +
          '(administrator) than this app.'
        );
      }
    }
    log(`${method} ok: hwnd=${hwnd} pid=${childPid} parent/owner=${parent}`);
    childHwnd = hwnd;
    needFrameChanged = true;
    lastAppliedKey = '';
    startWatching();
  }

  ipcMain.handle('external:embed', async (_e, opts = {}) => {
    try {
      clearTimeout(closeTimer); // a remount (React StrictMode / quick re-render) cancels a pending close
      const { exePath, args = '', windowTitle = '', method: rawMethod = 'overlay', fit: rawFit = 'fit', view, offset, contentPx: rawContent, visible = true, bounds, restart = false } = opts;
      const method = rawMethod === 'attach' ? 'attach' : 'overlay';
      const bad = validate(exePath);
      if (bad) return { ok: false, error: bad };

      if (stopped && !restart) return { ok: false, stopped: true, error: stopped.message };
      if (restart) { stopped = null; log('restart requested'); }

      const key = `${exePath}|${args}|${windowTitle}|${method}`;
      if (currentKey && currentKey !== key) await closeExternal('configuration changed');

      const w = loadWin32();
      if (childHwnd && !w.IsWindow(childHwnd)) {
        notifyStopped('The external program closed its own window.');
        return { ok: false, stopped: true, error: stopped.message };
      }

      if (!childHwnd) {
        if (!starting) {
          currentKey = key;
          const run = start({ exePath, args, windowTitle, method })
            .then(() => { currentKey = key; })
            .finally(() => { if (starting === run) starting = null; });
          starting = run;
        }
        await starting;
      } else if (starting) {
        await starting;
      }

      if (stopped) return { ok: false, stopped: true, error: stopped.message };
      if (!childHwnd) return { ok: false, error: 'External window not available.' };

      hookWindow(getWindow());
      // Optional user override of the program window size (physical px), Scroll mode only
      const contentPx =
        rawContent && Number.isFinite(rawContent.width) && Number.isFinite(rawContent.height) &&
        rawContent.width >= 200 && rawContent.height >= 150
          ? { w: Math.min(10000, Math.round(rawContent.width)), h: Math.min(10000, Math.round(rawContent.height)) }
          : null;
      lastLayout = { visible, bounds, method, fit: rawFit === 'scroll' ? 'scroll' : 'fit', view, offset, contentPx };
      requestApply();
      const sc = screen.getDisplayMatching(getWindow().getBounds()).scaleFactor || 1;
      return {
        ok: true,
        content: (contentPx || naturalPx)
          ? { width: (contentPx || naturalPx).w / sc, height: (contentPx || naturalPx).h / sc }
          : null,
      };
    } catch (error) {
      if (error?.cancelled) return { ok: false, error: 'cancelled' };
      console.error('[External] embed failed:', error);
      await closeExternal(`embed error: ${error.message}`);
      return { ok: false, error: error.message || String(error) };
    }
  });

  // Debounced: the renderer asks to close on every unmount, including the fake
  // unmount React StrictMode does in development. A new embed request within
  // 600 ms cancels it.
  ipcMain.on('external:close', () => {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => { closeExternal('panel closed by the renderer'); }, 600);
  });

  ipcMain.handle('external:pick-exe', async () => {
    const win = getWindow();
    const r = await dialog.showOpenDialog(win, {
      title: 'Select external program',
      properties: ['openFile'],
      filters: [{ name: 'Program', extensions: ['exe'] }],
    });
    return r.canceled ? null : r.filePaths[0];
  });

  return { closeExternal: (reason = 'app quit') => closeExternal(reason) };
}

module.exports = { registerExternalEmbed };
