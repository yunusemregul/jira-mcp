import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

test('storage writes atomically with user-only permissions', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'jira-mcp-storage-'));
  t.after(async () => rm(dataDir, { recursive: true, force: true }));
  process.env.JIRA_MCP_DATA_DIR = dataDir;
  const storage = await import(`../storage.js?storage-test=${Date.now()}`);

  const created = await storage.createSite({
    name: 'Test',
    siteUrl: 'https://example.atlassian.net',
    username: 'user@example.com',
    token: 'secret',
  });
  assert.equal((await storage.getSite(created.id)).token, 'secret');

  const file = join(dataDir, 'sites.json');
  assert.equal((await stat(dataDir)).mode & 0o777, 0o700);
  assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(file, 'utf8'))[0].id, created.id);
});
