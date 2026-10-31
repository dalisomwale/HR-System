// Starts the API and the web app together on Linux, macOS and Windows.
// (A shell "&" runs them one after the other in Windows cmd, so the web app never started.)
import { spawn, spawnSync } from 'node:child_process';

const windows = process.platform === 'win32';
const parts = [
  ['api', 'npm run dev --workspace server'],
  ['web', 'npm run dev --workspace client'],
];

const children = parts.map(([name, command]) => {
  // On Windows npm is a .cmd file, so it runs through the shell as one command line.
  const child = windows
    ? spawn(command, { stdio: 'inherit', shell: true })
    : spawn('npm', command.split(' ').slice(1), { stdio: 'inherit' });
  child.on('exit', (code) => {
    console.error(`[${name}] stopped${code ? ` (exit code ${code})` : ''}`);
    stopAll(code ?? 0);
  });
  return child;
});

let stopping = false;
function stopAll(code) {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    if (c.exitCode !== null) continue;
    // Killing the shell on Windows leaves node running underneath; end the whole tree.
    if (windows) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill();
  }
  process.exitCode = code;
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
