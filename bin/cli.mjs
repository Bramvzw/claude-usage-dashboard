#!/usr/bin/env node

import { execSync, exec } from 'node:child_process';
import { existsSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir, tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = join(__dirname, '..');

const claudeDir = join(homedir(), '.claude', 'projects');
if (!existsSync(claudeDir)) {
  console.error('No Claude Code data found at ~/.claude/projects/');
  console.error('Make sure you have used Claude Code at least once.');
  process.exit(1);
}

const outDir = join(tmpdir(), 'claude-usage-dashboard');
mkdirSync(outDir, { recursive: true });

copyFileSync(join(packageRoot, 'dashboard.html'), join(outDir, 'dashboard.html'));

console.log('Parsing Claude Code usage data...');
try {
  execSync(`node "${join(packageRoot, 'parse-usage.mjs')}"`, {
    env: { ...process.env, DASHBOARD_OUTPUT: outDir },
    stdio: 'inherit',
  });
} catch (err) {
  console.error('Failed to parse usage data:', err.message);
  process.exit(1);
}

const dashboardPath = join(outDir, 'dashboard.html');
console.log(`\nDashboard ready: ${dashboardPath}`);

function open(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'start'
    : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

open(dashboardPath);
