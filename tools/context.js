import { AsyncLocalStorage } from 'async_hooks';
import { getSite } from '../storage.js';

export const callCtx = new AsyncLocalStorage();

// ─── MCP Activity Log ─────────────────────────────────────────────────────────
const logClients = new Set();
const logBuffer = [];
let logSeq = 0;

function broadcast(entry) {
  const data = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of logClients) res.write(data);
}

export function getMcpLogBuffer() { return logBuffer; }
export function attachLogClient(res) { logClients.add(res); }
export function detachLogClient(res) { logClients.delete(res); }

function push(entry) {
  logBuffer.push(entry);
  if (logBuffer.length > 100) logBuffer.shift();
  broadcast(entry);
}

export function mcpLogSystem({ client, preview }) {
  push({ id: ++logSeq, type: 'system', client, preview, ts: Date.now() });
}

export function mcpLogStart({ tool, siteName, preview }) {
  const id = ++logSeq;
  push({ id, type: 'start', tool, siteName, preview, ts: Date.now() });
  return id;
}

export function mcpLog({ tool, siteName, preview, detail, isError, runId }) {
  push({ id: runId ?? ++logSeq, type: 'done', tool, siteName, preview, detail, isError, ts: Date.now() });
}

export function text(content) { return { content: [{ type: 'text', text: content }] }; }
export function image(data, mimeType, caption) {
  const content = [{ type: 'image', data, mimeType }];
  if (caption) content.unshift({ type: 'text', text: caption });
  return { content };
}
export function error(message) { return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true }; }

export { getSite };
