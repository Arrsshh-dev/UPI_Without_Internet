import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webSenderRoot = path.resolve(__dirname, '..');
const distDir = path.join(webSenderRoot, 'dist');
const targetDir = path.resolve(webSenderRoot, '..', 'src', 'main', 'resources', 'static', 'app');

if (!fs.existsSync(distDir)) {
  console.error(`Build output not found at ${distDir}. Run "npm run build" first.`);
  process.exit(1);
}

fs.rmSync(targetDir, { recursive: true, force: true });
fs.mkdirSync(targetDir, { recursive: true });
fs.cpSync(distDir, targetDir, { recursive: true });

console.log(`Copied ${distDir} -> ${targetDir}`);
