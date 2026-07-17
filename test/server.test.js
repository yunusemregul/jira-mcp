import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

test('server is loopback-only, redacts secrets, supports OAuth discovery and serves MCP', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'jira-mcp-server-'));
  process.env.JIRA_MCP_DATA_DIR = dataDir;
  const { startServer } = await import(`../server.js?server-test=${Date.now()}`);
  const server = startServer({ host: '127.0.0.1', port: 0, logStartup: false });
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dataDir, { recursive: true, force: true });
  });

  const address = server.address();
  assert.equal(address.address, '127.0.0.1');
  const base = `http://127.0.0.1:${address.port}`;

  const createResponse = await fetch(`${base}/api/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Test Jira',
      siteUrl: 'https://example.atlassian.net',
      username: 'user@example.com',
      token: 'super-secret',
    }),
  });
  assert.equal(createResponse.status, 201);
  const created = await createResponse.json();
  assert.equal(created.hasToken, true);
  assert.equal('token' in created, false);

  const sites = await fetch(`${base}/api/sites`).then(response => response.json());
  assert.equal(sites[0].hasToken, true);
  assert.equal('token' in sites[0], false);

  const discovery = await fetch(`${base}/.well-known/oauth-authorization-server`).then(response => response.json());
  assert.match(discovery.authorization_endpoint, /\/authorize$/);
  const token = await fetch(`${base}/token`, { method: 'POST' }).then(response => response.json());
  assert.equal(token.access_token, 'mock-access-token');

  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const tools = await client.listTools();
  assert.equal(tools.tools.length, 14);
  assert.ok(tools.tools.some(tool => tool.name === 'search_issues'));
  await client.close();
});

test('site API rejects insecure URLs and invalid email addresses', async t => {
  const dataDir = await mkdtemp(join(tmpdir(), 'jira-mcp-validation-'));
  process.env.JIRA_MCP_DATA_DIR = dataDir;
  const { startServer } = await import(`../server.js?validation-test=${Date.now()}`);
  const server = startServer({ host: '127.0.0.1', port: 0, logStartup: false });
  await once(server, 'listening');
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(dataDir, { recursive: true, force: true });
  });
  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/api/sites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Bad', siteUrl: 'http://example.test', username: 'invalid', token: 'secret' }),
  });
  assert.equal(response.status, 400);
});
