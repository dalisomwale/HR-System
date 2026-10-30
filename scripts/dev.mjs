// Starts the API and the web app together on Linux, macOS and Windows.
// (A shell "&" runs them one after the other in Windows cmd, so the web app never started.)
import { spawn } from 'node:child_process';

const parts = [
  ['api', ['run', 'dev', '--workspace', 'server']],
  ['web', ['run', 'dev', '--workspace', 'client']],
];
const children = parts.map(([name, args]) => {
  const child = spawn('npm', args, { stdio: 'inherit', shell: process.platform === 'win32' });
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
  for (const c of children) if (c.exitCode === null) c.kill();
  process.exitCode = code;
}
process.on('SIGINT', () => stopAll(0));
process.on('SIGTERM', () => stopAll(0));
