#!/usr/bin/env node
// Launcher for `npm run dev:all`.
//
// Probes for free ports for the daemon (OD_PORT, default 7456) and the Vite
// dev server (VITE_PORT, default 5173) before spawning `concurrently`, so a
// stray process holding either port doesn't kill the whole boot. The
// resolved ports are exported into the child env, which means:
//   * the daemon's cli.js sees the new OD_PORT and binds to it
//   * vite.config.ts reads the same OD_PORT and points its /api proxy at
//     the daemon's actual port
//   * Vite itself binds to VITE_PORT
//
// If a port is busy we walk forward up to PORT_SEARCH_RANGE steps and log
// the switch so the user notices.

import { spawn } from 'node:child_process';
import { findFreePort } from './resolve-dev-ports.mjs';

const desiredDaemon = Number(process.env.OD_PORT) || 7456;
const desiredVite = Number(process.env.VITE_PORT) || 5173;
const strictDaemonPort = process.env.OD_PORT_STRICT === '1';
const strictVitePort = process.env.VITE_PORT_STRICT === '1';

const daemonPort = strictDaemonPort
  ? desiredDaemon
  : await findFreePort(desiredDaemon, 'daemon');
const vitePort = strictVitePort
  ? desiredVite
  : await findFreePort(desiredVite, 'vite');

if (daemonPort !== desiredDaemon) {
  console.log(
    `[dev:all] daemon port ${desiredDaemon} is busy, switching to ${daemonPort}`,
  );
}
if (vitePort !== desiredVite) {
  console.log(
    `[dev:all] vite port ${desiredVite} is busy, switching to ${vitePort}`,
  );
}

const env = {
  ...process.env,
  OD_PORT: String(daemonPort),
  VITE_PORT: String(vitePort),
};

// We spawn the local `concurrently` bin via shell so Windows .cmd shims
// resolve correctly. The `npm:daemon` / `npm:dev` shorthand runs the
// matching package.json scripts, so any future tweak to those scripts is
// picked up automatically.
const child = spawn(
  'concurrently',
  ['-k', '-n', 'daemon,web', '-c', 'cyan,magenta', 'npm:daemon', 'npm:dev'],
  { env, stdio: 'inherit', shell: true },
);

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 0);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (!child.killed) child.kill(sig);
  });
}
