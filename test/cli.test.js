import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const cli = fileURLToPath(new URL('../bin/jira-mcp.mjs', import.meta.url));

test('CLI reports package version and help', () => {
  const version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), packageJson.version);

  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--host/);
  assert.match(help.stdout, /Atlassian API token/);
});

test('CLI rejects invalid ports', () => {
  const result = spawnSync(process.execPath, [cli, '--port', '70000'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /between 1 and 65535/);
});
