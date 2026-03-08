const { execSync } = require('child_process');

const ports = [3000, 3030, 5174];

function getListeningPids(port) {
  try {
    const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8'
    });
    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && /LISTENING/i.test(line))
      .map((line) => line.split(/\s+/).at(-1))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function killPid(pid) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function main() {
  if (process.platform !== 'win32') {
    console.log('[cleanup:ports] Non-Windows platform; skipping');
    return;
  }

  const pids = new Set();
  for (const port of ports) {
    for (const pid of getListeningPids(port)) {
      if (pid && pid !== String(process.pid)) {
        pids.add(pid);
      }
    }
  }

  if (pids.size === 0) {
    console.log('[cleanup:ports] No listeners found on ports 3000/3030/5174');
    return;
  }

  let killed = 0;
  for (const pid of pids) {
    if (killPid(pid)) {
      killed += 1;
    }
  }
  console.log(`[cleanup:ports] Killed ${killed}/${pids.size} process(es) on ports 3000/3030/5174`);
}

main();
