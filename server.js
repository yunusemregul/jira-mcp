import express from 'express';
import { createServer } from 'http';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join, resolve } from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { listSites, getSite, createSite, updateSite, deleteSite } from './storage.js';
import { normalizeSiteUrl, testConnection } from './jira.js';
import { registerAllTools, tools as allTools } from './tools/index.js';
import { getMcpLogBuffer, attachLogClient, detachLogClient, mcpLogSystem } from './tools/context.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const { version } = createRequire(import.meta.url)('./package.json');
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 18433;

function parsePort(value) {
  const port = Number(value ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }
  return port;
}

const HOST = process.env.HOST?.trim() || DEFAULT_HOST;
const PORT = parsePort(process.env.PORT);
const CONFIG_FILE = join(process.env.JIRA_MCP_DATA_DIR || join(homedir(), '.jira-mcp'), 'sites.json');

// ─── MCP server factory ───────────────────────────────────────────────────────
function createMcpInstance(getClientLabel) {
  const mcp = new McpServer({ name: 'jira-mcp', version }, { timeout: 60000 });
  registerAllTools(mcp, getClientLabel);
  return mcp;
}

let clientCounter = 0;
function clientLabel(session) {
  const num = `Client #${session.clientNum}`;
  const v = session.clientInfo?.version;
  if (!v) return num;
  return `${num} · ${v.title || v.name} ${v.version}`;
}

// ─── Express ──────────────────────────────────────────────────────────────────
export const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'");
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '32kb' }));
app.use('/static', express.static(join(__dirname, 'static')));
app.use('/', express.static(join(__dirname, 'static')));

// Mock OAuth compatibility endpoints, matching hac-mcp. These auto-approve local
// MCP clients and do not authenticate access to Jira; Jira itself is accessed
// with the API token configured in the local Web UI.
const BASE_URL = `http://localhost:${PORT}`;

app.get('/.well-known/oauth-authorization-server', (_req, res) => {
  res.json({
    issuer: BASE_URL,
    authorization_endpoint: `${BASE_URL}/authorize`,
    token_endpoint: `${BASE_URL}/token`,
    registration_endpoint: `${BASE_URL}/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code'],
    code_challenge_methods_supported: ['S256'],
  });
});

app.post('/register', (req, res) => {
  const body = req.body ?? {};
  res.json({
    client_id: 'mock-client',
    client_secret: 'mock-secret',
    client_id_issued_at: Math.floor(Date.now() / 1000),
    redirect_uris: body.redirect_uris ?? [],
    grant_types: body.grant_types ?? ['authorization_code'],
    response_types: body.response_types ?? ['code'],
    token_endpoint_auth_method: 'client_secret_basic',
  });
});

app.get('/authorize', (req, res) => {
  const { redirect_uri, state } = req.query;
  const code = `mock-code-${Date.now()}`;
  const url = new URL(redirect_uri);
  url.searchParams.set('code', code);
  if (state) url.searchParams.set('state', state);
  res.redirect(url.toString());
});

app.post('/token', (_req, res) => {
  res.json({
    access_token: 'mock-access-token',
    token_type: 'bearer',
    expires_in: 86400,
  });
});

function requiredString(value, label, maxLength) {
  const result = typeof value === 'string' ? value.trim() : '';
  if (!result) throw new Error(`${label} is required.`);
  if (result.length > maxLength) throw new Error(`${label} is too long.`);
  return result;
}

export function normalizeSiteInput(body, { requireToken = true } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid site payload.');
  const siteUrl = normalizeSiteUrl(requiredString(body.siteUrl, 'Site URL', 2048));
  const name = requiredString(body.name, 'Name', 100);
  const username = requiredString(body.username, 'Email', 320);
  if (!username.includes('@')) throw new Error('Email must be a valid Atlassian account email.');

  const token = typeof body.token === 'string' ? body.token.trim() : '';
  if (requireToken && !token) throw new Error('API token is required.');
  if (token.length > 4096) throw new Error('API token is too long.');

  return { siteUrl, name, username, ...(token ? { token } : {}) };
}

function publicSite(site) {
  const { token, ...safe } = site;
  return { ...safe, hasToken: Boolean(token) };
}

// ─── Sites API ────────────────────────────────────────────────────────────────
app.get('/api/sites', async (_req, res) => res.json((await listSites()).map(publicSite)));

app.post('/api/sites', async (req, res) => {
  try { res.status(201).json(publicSite(await createSite(normalizeSiteInput(req.body)))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/sites/:id', async (req, res) => {
  try { res.json(publicSite(await updateSite(req.params.id, normalizeSiteInput(req.body, { requireToken: false })))); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/sites/:id', async (req, res) => {
  try { await deleteSite(req.params.id); res.json({ ok: true }); }
  catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/sites/:id/test', async (req, res) => {
  const site = await getSite(req.params.id);
  if (!site) return res.status(404).json({ ok: false, error: 'Site not found' });
  try { await testConnection(site); res.json({ ok: true }); }
  catch (e) { res.json({ ok: false, error: e.message }); }
});

app.post('/api/test-connection', async (req, res) => {
  try {
    await testConnection(normalizeSiteInput(req.body));
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

app.get('/healthz', (_req, res) => res.json({ ok: true, name: 'jira-mcp', version }));

// ─── MCP Activity Log SSE ─────────────────────────────────────────────────────
app.get('/api/mcp-log', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  for (const entry of getMcpLogBuffer()) res.write(`data: ${JSON.stringify(entry)}\n\n`);
  attachLogClient(res);
  req.on('close', () => detachLogClient(res));
});

// ─── Manifest & Status API ────────────────────────────────────────────────────
app.get('/api/manifest', (_req, res) => res.json({
  name: 'jira-mcp',
  version,
  description: 'Jira Cloud MCP Server',
  tools: allTools.map(t => ({
    name: t.name,
    category: t.category ?? 'util',
    description: t.description,
    params: t.inputSchema
      ? Object.entries(t.inputSchema).map(([name, schema]) => ({
          name,
          description: schema.description ?? null,
          optional: schema.isOptional?.() === true,
        }))
      : [],
  })),
}));

app.get('/api/status', async (_req, res) => {
  const sites = await listSites();
  const sessions = [...mcpSessions.values(), ...httpMcpSessions.values()];
  const clients = sessions.map(s => ({ ...(s.clientInfo ?? {}), connectedAt: s.connectedAt, toolCalls: s.toolCalls }));
  res.json({ siteCount: sites.length, connectedClients: sessions.length, clients });
});

// ─── MCP SSE ──────────────────────────────────────────────────────────────────
const httpMcpSessions = new Map();
app.all('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    let session = sessionId ? httpMcpSessions.get(sessionId) : null;
    if (!session && !sessionId && req.method === 'POST' && isInitializeRequest(req.body)) {
      const clientNum = ++clientCounter;
      session = { mcp: null, transport: null, clientNum, clientInfo: null, connectedAt: Date.now(), toolCalls: 0 };
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: id => {
          httpMcpSessions.set(id, session);
          mcpLogSystem({ client: `Client #${clientNum}`, preview: 'connected via Streamable HTTP' });
        },
      });
      const mcp = createMcpInstance(id => {
        const s = httpMcpSessions.get(id) ?? session;
        if (s) { s.toolCalls++; return clientLabel(s); }
        return null;
      });
      session.mcp = mcp;
      session.transport = transport;
      mcp.server.oninitialized = () => {
        const version = mcp.server.getClientVersion() ?? null;
        const caps = mcp.server.getClientCapabilities() ?? null;
        session.clientInfo = { version, caps };
        mcpLogSystem({ client: clientLabel(session), preview: 'initialized' });
      };
      transport.onclose = () => {
        const id = transport.sessionId;
        mcpLogSystem({ client: clientLabel(session), preview: 'disconnected' });
        if (id) httpMcpSessions.delete(id);
      };
      await mcp.connect(transport);
    }
    if (!session) {
      return res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid MCP session ID' }, id: null });
    }
    await session.transport.handleRequest(req, res, req.body);
  } catch (e) {
    console.error('[MCP HTTP] error:', e);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  }
});

// Legacy SSE remains available at /mcp/sse for Claude and existing clients.
const mcpSessions = new Map();
app.get('/mcp/sse', async (_req, res) => {
  const transport = new SSEServerTransport('/mcp/messages', res);
  const clientNum = ++clientCounter;
  const session = { mcp: null, transport, clientNum, clientInfo: null, connectedAt: Date.now(), toolCalls: 0 };
  const mcp = createMcpInstance(sessionId => {
    const s = mcpSessions.get(sessionId);
    if (s) { s.toolCalls++; return clientLabel(s); }
    return null;
  });
  session.mcp = mcp;
  mcpSessions.set(transport.sessionId, session);
  mcpLogSystem({ client: `Client #${clientNum}`, preview: 'connected via SSE' });
  mcp.server.oninitialized = () => {
    const version = mcp.server.getClientVersion() ?? null;
    const caps = mcp.server.getClientCapabilities() ?? null;
    session.clientInfo = { version, caps };
    mcpLogSystem({ client: clientLabel(session), preview: 'initialized' });
  };
  res.on('close', () => {
    mcpLogSystem({ client: clientLabel(session), preview: 'disconnected' });
    mcpSessions.delete(transport.sessionId);
    mcp.close();
  });
  await mcp.connect(transport);
});

app.post('/mcp/messages', async (req, res) => {
  const session = mcpSessions.get(req.query.sessionId);
  if (session) await session.transport.handlePostMessage(req, res, req.body);
  else res.status(400).send('Unknown session');
});

// ─── Start ────────────────────────────────────────────────────────────────────
export function startServer({ host = HOST, port = PORT, logStartup = true } = {}) {
  const httpServer = createServer(app);
  httpServer.listen(port, host, () => {
    if (!logStartup) return;
    const address = httpServer.address();
    const actualPort = typeof address === 'object' && address ? address.port : port;
    const displayHost = host === '0.0.0.0' || host === '::' ? 'localhost' : host.includes(':') ? `[${host}]` : host;
    const base = `http://${displayHost}:${actualPort}`;
    const hasColor = process.stdout.hasColors?.() ?? process.stdout.isTTY;
    const c = hasColor
      ? { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', blue: '\x1b[34m' }
      : { reset: '', bold: '', dim: '', green: '', blue: '' };

    const label = s => `${c.dim}${s}${c.reset}`;
    const value = s => `${c.blue}${s}${c.reset}`;
    const heading = s => `${c.bold}${s}${c.reset}`;
    const code = s => `${c.green}${s}${c.reset}`;

    console.log('');
    console.log(`  ${c.bold}${c.green}Jira MCP is running${c.reset}`);
    console.log('');
    console.log(`  ${label('Web UI      ')}  ${value(base)}`);
    console.log(`  ${label('MCP HTTP    ')}  ${value(`${base}/mcp`)}`);
    console.log(`  ${label('MCP SSE     ')}  ${value(`${base}/mcp/sse`)}`);
    console.log(`  ${label('Config file ')}  ${value(CONFIG_FILE)}`);
    console.log('');
    console.log(`  ${heading('Codex')}`);
    console.log(`  ${label('Run this command to register:')}`);
    console.log('');
    console.log(`  ${code(`codex mcp add jira-mcp --url ${base}/mcp`)}`);
    console.log('');
    console.log(`  ${heading('Claude Code (legacy SSE)')}`);
    console.log(`  ${label('Run this command to register:')}`);
    console.log('');
    console.log(`  ${code(`claude mcp add --transport sse jira-mcp ${base}/mcp/sse`)}`);
    console.log('');
    console.log(`  ${heading('Other MCP Clients')}`);
    console.log(`  ${label('Add the following to your MCP client config:')}`);
    console.log('');
    console.log(`  ${code('{')}`);
    console.log(`  ${code('  "mcpServers": {')}`);
    console.log(`  ${code('    "jira-mcp": {')}`);
    console.log(`  ${code(`      "url": "${base}/mcp"`)}`);
    console.log(`  ${code('    }')}`);
    console.log(`  ${code('  }')}`);
    console.log(`  ${code('}')}`);
    console.log('');
  });
  return httpServer;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) startServer();
