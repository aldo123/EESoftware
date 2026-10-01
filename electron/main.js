const { app, BrowserWindow, dialog, screen } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const isPackaged = app.isPackaged;
const FRONTEND_DEV_URL = process.env.FRONTEND_DEV_URL || 'http://127.0.0.1:5173';
const BACKEND_URL = process.env.BACKEND_URL || 'http://127.0.0.1:8000';
const BACKEND_HEALTH_URL = `${BACKEND_URL}/api/health`;

let mainWindow = null;
let backendProcess = null;
let frontendDevProcess = null;
let isShuttingDown = false;
let isQuitting = false;

function projectRoot() {
  // EE Interlock/
  //   backend/
  //   frontend-updated/frontend/
  //   electron/
  return path.resolve(__dirname, '..');
}

function backendDevDir() {
  return path.join(projectRoot(), 'backend');
}

function frontendDevDir() {
  return path.join(projectRoot(), 'frontend-updated', 'frontend');
}

function packagedBackendExe() {
  // PyInstaller --onedir creates: dist/main/main.exe + _internal/.
  // electron-builder can place that folder either directly under
  // resources/backend or under resources/backend/main depending on how
  // extraResources was configured. Support both layouts so the packaged
  // app does not fail just because the folder nesting differs.
  const candidates = [
    path.join(process.resourcesPath, 'backend', 'main.exe'),
    path.join(process.resourcesPath, 'backend', 'main', 'main.exe'),
    path.join(process.resourcesPath, 'backend-dist', 'main.exe'),
    path.join(process.resourcesPath, 'backend-dist', 'main', 'main.exe'),
    path.join(process.resourcesPath, 'main.exe'),
  ];

  const found = candidates.find(fs.existsSync);
  if (found) {
    console.log(`[Electron] Packaged backend found: ${found}`);
    return found;
  }

  // Return the first conventional path for a useful error message.
  return candidates[0];
}



function ensurePackagedRuntimeLinks() {
  if (!isPackaged || process.platform !== 'win32') return;

  const backendRoot = path.join(process.resourcesPath, 'backend');
  const internalRoot = path.join(backendRoot, '_internal');
  const dataTarget = path.join(backendRoot, 'data');
  const pagesTarget = path.join(backendRoot, 'pages');
  const dataLink = path.join(internalRoot, 'data');
  const pagesLink = path.join(internalRoot, 'pages');

  fs.mkdirSync(internalRoot, { recursive: true });

  const ensureJunction = (target, linkPath, label) => {
    if (!fs.existsSync(target)) {
      console.warn(`[Electron] ${label} target does not exist: ${target}`);
      return;
    }

    try {
      if (fs.existsSync(linkPath)) {
        const realLink = fs.realpathSync(linkPath);
        const realTarget = fs.realpathSync(target);
        if (realLink.toLowerCase() === realTarget.toLowerCase()) {
          console.log(`[Electron] ${label} junction already correct: ${linkPath} -> ${target}`);
          return;
        }

        const st = fs.lstatSync(linkPath);
        if (st.isSymbolicLink()) {
          fs.unlinkSync(linkPath);
          console.log(`[Electron] Replacing ${label} junction: ${linkPath}`);
        } else if (st.isDirectory()) {
          const entries = fs.readdirSync(linkPath);
          if (entries.length === 0) {
            fs.rmdirSync(linkPath);
            console.log(`[Electron] Replacing empty ${label} directory with junction: ${linkPath}`);
          } else {
            console.warn(`[Electron] Existing non-empty ${label} directory kept: ${linkPath}`);
            return;
          }
        } else {
          fs.unlinkSync(linkPath);
        }
      }

      fs.symlinkSync(target, linkPath, 'junction');
      console.log(`[Electron] Created ${label} junction: ${linkPath} -> ${target}`);
    } catch (error) {
      throw new Error(`Failed to prepare ${label} runtime path. ${error.message}`);
    }
  };

  // Older backend modules calculate BASE_DIR from their __file__. In a
  // PyInstaller one-dir build that resolves under resources/backend/_internal.
  // These junctions make their existing data/pages paths transparently point to
  // the real persistent folders next to main.exe, without requiring every
  // backend module to be rewritten.
  ensureJunction(dataTarget, dataLink, 'backend data');
  ensureJunction(pagesTarget, pagesLink, 'backend pages');
}

function packagedFrontendIndex() {
  const candidates = [
    path.join(process.resourcesPath, 'frontend', 'dist', 'index.html'),
    path.join(process.resourcesPath, 'frontend-dist', 'index.html'),
  ];
  return candidates.find(fs.existsSync) || candidates[0];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isPortOpen(url) {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: 1200 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function waitForUrl(url, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await isPortOpen(url)) return true;
    await sleep(250);
  }
  return false;
}

async function waitBackend(timeoutMs = 30000) {
  return waitForUrl(BACKEND_HEALTH_URL, timeoutMs);
}

function logProcessOutput(label, child) {
  child.stdout?.on('data', (data) => {
    const text = String(data).trimEnd();
    if (text) console.log(`[${label}] ${text}`);
  });
  child.stderr?.on('data', (data) => {
    const text = String(data).trimEnd();
    if (text) console.error(`[${label}] ${text}`);
  });
}

function attachProcessLifecycle(label, child, onExit) {
  child.on('error', (err) => {
    console.error(`[Electron] ${label} process error:`, err);
  });
  child.once('exit', (code, signal) => {
    console.log(`[Electron] ${label} exited. code=${code} signal=${signal}`);
    onExit?.();
  });
}

function spawnBackend() {
  if (backendProcess && !backendProcess.killed) {
    return Promise.resolve();
  }

  if (isPackaged) {
    const exe = packagedBackendExe();
    if (!fs.existsSync(exe)) {
      return Promise.reject(new Error(`Backend executable not found: ${exe}`));
    }

    console.log(`[Electron] Starting packaged backend: ${exe}`);
    backendProcess = spawn(exe, [], {
      cwd: path.dirname(exe),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
  } else {
    const backendDir = backendDevDir();
    const entry = path.join(backendDir, 'main.py');
    if (!fs.existsSync(entry)) {
      return Promise.reject(new Error(`Backend main.py not found: ${entry}`));
    }

    const python = process.env.PYTHON_EXECUTABLE ||
      (process.platform === 'win32' ? 'python' : 'python3');

    console.log(`[Electron] Starting development backend: ${python} ${entry}`);
    backendProcess = spawn(python, [entry], {
      cwd: backendDir,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
  }

  logProcessOutput('Backend', backendProcess);
  attachProcessLifecycle('Backend', backendProcess, () => {
    backendProcess = null;
  });

  return Promise.resolve();
}

function spawnFrontendDevServer() {
  if (isPackaged) return Promise.resolve();

  if (frontendDevProcess && !frontendDevProcess.killed) {
    return Promise.resolve();
  }

  const frontendDir = frontendDevDir();
  const packageJson = path.join(frontendDir, 'package.json');
  if (!fs.existsSync(packageJson)) {
    return Promise.reject(new Error(`Frontend package.json not found: ${packageJson}`));
  }

  // Electron owns the Vite dev server in development mode.
  // This means closing Electron also terminates the Vite process tree.
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  console.log(`[Electron] Starting frontend dev server in ${frontendDir}`);

  frontendDevProcess = spawn(npmCommand, ['run', 'dev', '--', '--host', '127.0.0.1'], {
    cwd: frontendDir,
    env: { ...process.env },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32',
  });

  logProcessOutput('Frontend', frontendDevProcess);
  attachProcessLifecycle('Frontend', frontendDevProcess, () => {
    frontendDevProcess = null;
  });

  return Promise.resolve();
}

function runKillProcessTree(pid) {
  if (!pid || !Number.isFinite(Number(pid))) return Promise.resolve();

  return new Promise((resolve) => {
    if (process.platform === 'win32') {
      // /T terminates the full child process tree, /F forces termination.
      execFile('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true }, (error) => {
        if (error) {
          console.warn(`[Electron] taskkill PID ${pid}: ${error.message}`);
        } else {
          console.log(`[Electron] Terminated process tree PID ${pid}`);
        }
        resolve();
      });
      return;
    }

    // For POSIX, children are started in their own process group.
    // Negative PID addresses the whole process group.
    try {
      process.kill(-Number(pid), 'SIGTERM');
      console.log(`[Electron] Sent SIGTERM to process group ${pid}`);
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        console.warn(`[Electron] Failed to terminate process group ${pid}:`, error.message);
      }
    }

    setTimeout(() => {
      try {
        process.kill(-Number(pid), 'SIGKILL');
        console.log(`[Electron] Sent SIGKILL to process group ${pid}`);
      } catch (error) {
        if (error?.code !== 'ESRCH') {
          console.warn(`[Electron] Failed to force terminate process group ${pid}:`, error.message);
        }
      }
      resolve();
    }, 1200);
  });
}

async function terminateManagedProcess(label, processRefName) {
  const child = processRefName === 'backend' ? backendProcess : frontendDevProcess;
  if (!child || child.killed) {
    if (processRefName === 'backend') backendProcess = null;
    else frontendDevProcess = null;
    return;
  }

  const pid = child.pid;
  console.log(`[Electron] Stopping ${label} PID ${pid}...`);

  await runKillProcessTree(pid);

  // Give the OS/Node a moment to deliver the exit event and release handles.
  await sleep(150);

  if (processRefName === 'backend') backendProcess = null;
  else frontendDevProcess = null;
}

async function shutdownManagedProcesses() {
  if (isShuttingDown) return;
  isShuttingDown = true;

  // Backend and Vite are independent. Stop both even when one fails.
  await Promise.all([
    terminateManagedProcess('backend', 'backend'),
    terminateManagedProcess('frontend dev server', 'frontend'),
  ]);
}

async function createWindow() {
  // Fit the native window exactly to the primary display's available work area
  // (excluding the Windows taskbar). We do NOT use maximize/fullscreen, so the
  // native title bar can expose only the Minimize (-) and Close (X) controls.
  const primaryDisplay = screen.getPrimaryDisplay();
  const workArea = primaryDisplay.workArea;

  mainWindow = new BrowserWindow({
    x: workArea.x,
    y: workArea.y,
    width: workArea.width,
    height: workArea.height,
    minWidth: workArea.width,
    minHeight: workArea.height,
    maxWidth: workArea.width,
    maxHeight: workArea.height,
    resizable: false,
    movable: false,
    show: false,
    backgroundColor: '#0b1120',
    // The window is already fitted to the screen, so the maximize button is
    // unnecessary. Keep only Minimize (-) and Close (X).
    minimizable: true,
    maximizable: false,
    fullscreenable: false,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    // The window already matches the display work area. Do not call maximize().
    mainWindow.show();
    mainWindow.focus();
  });

  if (isPackaged) {
    const indexFile = packagedFrontendIndex();
    if (!fs.existsSync(indexFile)) {
      throw new Error(`Frontend build not found: ${indexFile}`);
    }
    await mainWindow.loadFile(indexFile);
  } else {
    const devUrl = FRONTEND_DEV_URL;
    const ready = await waitForUrl(devUrl, 30000);
    if (!ready) {
      throw new Error(`Frontend dev server did not become ready at ${devUrl}`);
    }
    await mainWindow.loadURL(devUrl);

    if (process.env.OPEN_DEVTOOLS === '1') {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function start() {
  try {
    // Electron owns these child processes. Do not reuse an unrelated process
    // that happens to occupy the same port; fail loudly instead.
    if (await isPortOpen(BACKEND_HEALTH_URL)) {
      throw new Error(
        `Port/backend is already in use at ${BACKEND_HEALTH_URL}. ` +
        'Close the existing EE Interlock backend before starting another instance.'
      );
    }

    if (isPackaged) ensurePackagedRuntimeLinks();

    await spawnBackend();
    const backendReady = await waitBackend();
    if (!backendReady) {
      throw new Error(`Backend did not become ready at ${BACKEND_HEALTH_URL}`);
    }

    if (!isPackaged) {
      if (await isPortOpen(FRONTEND_DEV_URL)) {
        console.log(`[Electron] Using existing frontend dev server at ${FRONTEND_DEV_URL}`);
      } else {
        await spawnFrontendDevServer();
      }
    }

    await createWindow();
  } catch (error) {
    console.error('[Electron] Startup failed:', error);
    await shutdownManagedProcesses();
    dialog.showErrorBox('EE Interlock Startup Error', error.message || String(error));
    app.quit();
  }
}

app.whenReady().then(start);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', (event) => {
  if (isQuitting) return;

  // Pause the quit event until all Electron-owned child processes have been
  // terminated. This prevents main.exe/python/npm/vite descendants from
  // surviving after the desktop app closes.
  event.preventDefault();
  isQuitting = true;

  shutdownManagedProcesses()
    .catch((error) => {
      console.error('[Electron] Shutdown cleanup failed:', error);
    })
    .finally(() => {
      app.exit(0);
    });
});

app.on('will-quit', async (event) => {
  if (backendProcess || frontendDevProcess) {
    event.preventDefault();
    await shutdownManagedProcesses();
    app.exit(0);
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0 && !isShuttingDown) {
    createWindow().catch((error) => {
      console.error('[Electron] Failed to recreate window:', error);
    });
  }
});

// Extra cleanup for termination paths that can happen outside normal window
// close handling in development/packaged environments.
process.on('SIGINT', async () => {
  if (isShuttingDown) return;
  await shutdownManagedProcesses();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  await shutdownManagedProcesses();
  process.exit(0);
});
