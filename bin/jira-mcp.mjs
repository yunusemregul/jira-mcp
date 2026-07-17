#!/usr/bin/env node
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = createRequire(import.meta.url)(join(__dirname, '../package.json'));

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const option = (name, short) => {
  const idx = args.findIndex(a => a === name || (short && a === short));
  if (idx === -1) return null;
  const val = args[idx + 1];
  if (!val || val.startsWith('-')) { console.error(`Missing value for ${name}`); process.exit(1); }
  return val;
};

if (flag('--help') || flag('-h')) {
  console.log(`
jira-mcp v${version}

  A local MCP server for Jira Cloud using an Atlassian API token.

Usage:
  jira-mcp [options]

Options:
  -p, --port    Port to listen on (default: 18433, env: PORT)
      --host    Host to bind (default: 127.0.0.1, env: HOST)
  -v, --version Print version
  -h, --help    Show this help
  `.trim());
  process.exit(0);
}

if (flag('--version') || flag('-v')) { console.log(version); process.exit(0); }

const port = option('--port', '-p');
if (port) {
  const parsed = Number(port);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    console.error('Port must be an integer between 1 and 65535.');
    process.exit(1);
  }
  process.env.PORT = port;
}

const host = option('--host');
if (host) process.env.HOST = host;

const { startServer } = await import('../server.js');
startServer();
