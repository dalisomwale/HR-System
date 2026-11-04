// Sets lines in the project's .env without opening an editor, on Windows as well as Linux:
//   node scripts/set-env.mjs KEY=value OTHER=value   (sets or adds each line)
//   node scripts/set-env.mjs --remove KEY             (removes a line)
// Values are written exactly as given. Other lines are left alone.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/set-env.mjs KEY=value [KEY=value ...] | --remove KEY');
  process.exit(1);
}

const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const eol = text.includes('\r\n') ? '\r\n' : '\n';
let lines = text.split(/\r?\n/);
if (lines.at(-1) === '') lines.pop();

const keyOf = (line) => /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)?.[1];

for (let i = 0; i < args.length; i += 1) {
  if (args[i] === '--remove') {
    const key = args[(i += 1)];
    lines = lines.filter((l) => keyOf(l) !== key);
    console.error(`removed ${key}`);
    continue;
  }
  const eq = args[i].indexOf('=');
  const key = args[i].slice(0, eq);
  if (eq < 1 || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    console.error(`Not KEY=value: ${args[i]}`);
    process.exit(1);
  }
  const line = `${key}=${args[i].slice(eq + 1)}`;
  const at = lines.findIndex((l) => keyOf(l) === key);
  if (at >= 0) lines[at] = line;
  else lines.push(line);
  // Never echo secrets back to the screen.
  console.error(`set ${key}`);
}
fs.writeFileSync(file, lines.join(eol) + eol);
