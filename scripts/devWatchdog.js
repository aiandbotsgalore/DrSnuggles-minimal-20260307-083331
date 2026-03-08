const { spawn, spawnSync } = require('child_process');
const path = require('path');
const net = require('net');

const rootDir = path.resolve(__dirname, '..');
const checkIntervalMs = 3000;
const restartCooldownMs = 4000;
const rendererStartupGraceMs = 20000;
const sidecarStartupGraceMs = 45000;
const maxRapidRestarts = 5;
const rapidRestartWindowMs = 60000;
const defaultRendererPort = 5174;
const defaultSidecarPort = 3030;

function parsePort(envValue, fallback, envName) {
  const parsed = Number(envValue);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535;
  if (valid) return parsed;
  if (envValue !== undefined) {
    console.warn(`[watchdog] invalid ${envName}='${envValue}', using ${fallback}`);
  }
  return fallback;
}

const rendererPort = parsePort(process.env.SNUGGLES_RENDERER_PORT, defaultRendererPort, 'SNUGGLES_RENDERER_PORT');
const sidecarPort = parsePort(process.env.SNUGGLES_SIDECAR_PORT, defaultSidecarPort, 'SNUGGLES_SIDECAR_PORT');

let sidecar = null;
let renderer = null;
let lastRendererRestartAt = 0;
let lastSidecarRestartAt = 0;
let rendererStartedAt = 0;
let sidecarStartedAt = 0;
let shuttingDown = false;
let monitorInFlight = false;
let monitorTimer = null;
const restartEvents = [];

function runCleanupPorts() {
  const cleanup = spawnSync('node', [path.join('scripts', 'cleanupPorts.js')], {
    cwd: rootDir,
    stdio: 'inherit',
    shell: true
  });
  if (cleanup.error) {
    console.warn('[watchdog] cleanupPorts error:', cleanup.error.message);
  } else if (typeof cleanup.status === 'number' && cleanup.status !== 0) {
    console.warn(`[watchdog] cleanupPorts exited with status=${cleanup.status}`);
  }
}

function startProcess(name, script) {
  console.log(`[watchdog] starting ${name} (${script})`);
  const child = process.platform === 'win32'
    ? spawn('cmd.exe', ['/d', '/s', '/c', `npm run ${script}`], {
        cwd: rootDir,
        shell: false,
        stdio: 'inherit'
      })
    : spawn('npm', ['run', script], {
        cwd: rootDir,
        shell: false,
        stdio: 'inherit'
      });

  child.on('exit', (code, signal) => {
    if (shuttingDown) return;
    console.log(`[watchdog] ${name} exited (code=${code}, signal=${signal})`);
  });

  return child;
}

function stopProcessTree(child) {
  if (!child || child.exitCode !== null || child.killed) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { stdio: 'ignore' });
    return;
  }
  child.kill('SIGTERM');
}

function canRestart(lastAt) {
  return Date.now() - lastAt > restartCooldownMs;
}

function recordRestart(tag) {
  const now = Date.now();
  restartEvents.push({ tag, at: now });
  while (restartEvents.length && now - restartEvents[0].at > rapidRestartWindowMs) {
    restartEvents.shift();
  }
  if (restartEvents.length >= maxRapidRestarts) {
    console.log('[watchdog] excessive restarts detected, performing full cleanup and restart');
    runCleanupPorts();
    stopProcessTree(renderer);
    stopProcessTree(sidecar);
    renderer = null;
    sidecar = null;
    restartEvents.length = 0;
  }
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (open) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(open);
    };

    socket.setTimeout(1000);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}

function startAll() {
  runCleanupPorts();
  sidecar = startProcess('sidecar', 'dev:sidecar');
  lastSidecarRestartAt = Date.now();
  sidecarStartedAt = lastSidecarRestartAt;
  renderer = startProcess('renderer', 'dev:renderer');
  rendererStartedAt = Date.now();
  lastRendererRestartAt = rendererStartedAt;
}

async function monitor() {
  if (shuttingDown || monitorInFlight) return;
  monitorInFlight = true;

  try {
    const rendererPortOpen = await isPortOpen(rendererPort);
    const sidecarPortOpen = await isPortOpen(sidecarPort);
    const now = Date.now();
    const sidecarPastGrace = now - sidecarStartedAt >= sidecarStartupGraceMs;
    const rendererPastGrace = now - rendererStartedAt >= rendererStartupGraceMs;

    if ((!sidecar || sidecar.exitCode !== null) && canRestart(lastSidecarRestartAt)) {
      lastSidecarRestartAt = now;
      recordRestart('sidecar-exit');
      sidecar = startProcess('sidecar', 'dev:sidecar');
      sidecarStartedAt = lastSidecarRestartAt;
    } else if (!sidecarPortOpen && sidecarPastGrace && canRestart(lastSidecarRestartAt)) {
      lastSidecarRestartAt = now;
      console.log(`[watchdog] sidecar port ${sidecarPort} is down, restarting sidecar`);
      stopProcessTree(sidecar);
      recordRestart('sidecar-port-down');
      sidecar = startProcess('sidecar', 'dev:sidecar');
      sidecarStartedAt = lastSidecarRestartAt;
    }

    if ((!renderer || renderer.exitCode !== null) && canRestart(lastRendererRestartAt)) {
      lastRendererRestartAt = now;
      recordRestart('renderer-exit');
      renderer = startProcess('renderer', 'dev:renderer');
      rendererStartedAt = lastRendererRestartAt;
    } else if (!rendererPortOpen && rendererPastGrace && canRestart(lastRendererRestartAt)) {
      lastRendererRestartAt = now;
      console.log(`[watchdog] renderer port ${rendererPort} is down, restarting renderer`);
      stopProcessTree(renderer);
      recordRestart('renderer-port-down');
      renderer = startProcess('renderer', 'dev:renderer');
      rendererStartedAt = lastRendererRestartAt;
    }
  } finally {
    monitorInFlight = false;
  }
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (monitorTimer) {
    clearInterval(monitorTimer);
    monitorTimer = null;
  }
  console.log('\n[watchdog] stopping child processes...');
  stopProcessTree(renderer);
  stopProcessTree(sidecar);
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGBREAK', shutdown);

startAll();
monitorTimer = setInterval(() => {
  monitor().catch((error) => {
    console.error('[watchdog] monitor error:', error);
  });
}, checkIntervalMs);
