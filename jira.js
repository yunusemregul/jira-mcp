// Jira Cloud REST API v3 client
// Auth: Basic (Atlassian account email + API token from id.atlassian.com)

import { mkdir, open, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const REQUEST_TIMEOUT_MS = positiveInteger(process.env.JIRA_REQUEST_TIMEOUT_MS, DEFAULT_REQUEST_TIMEOUT_MS);
const MAX_ATTACHMENT_BYTES = positiveInteger(process.env.JIRA_MAX_ATTACHMENT_BYTES, DEFAULT_MAX_ATTACHMENT_BYTES);

export function normalizeSiteUrl(siteUrl) {
  const url = new URL(String(siteUrl));
  if (url.protocol !== 'https:') throw new Error('Jira site URL must use HTTPS.');
  if (url.username || url.password) throw new Error('Jira site URL must not contain credentials.');
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url.toString().replace(/\/$/, '');
}

const BASE = siteUrl => `${normalizeSiteUrl(siteUrl)}/rest/api/3`;

function makeHeaders(site) {
  const auth = Buffer.from(`${site.username}:${site.token}`).toString('base64');
  return {
    'Accept': 'application/json',
    'Content-Type': 'application/json',
    'Authorization': `Basic ${auth}`,
  };
}

async function apiFetch(path, site, options = {}) {
  if (!path.startsWith('/')) throw new Error('Jira API path must be relative.');
  const url = `${BASE(site.siteUrl)}${path}`;
  const res = await fetch(url, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { ...makeHeaders(site), ...(options.headers ?? {}) },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msgs = data?.errorMessages?.length ? data.errorMessages.join('; ')
      : data?.message || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msgs);
  }
  return data;
}

export async function testConnection(site) {
  return apiFetch('/myself', site);
}

export async function getIssue(site, key, fields = 'summary,status,issuetype,priority,assignee,reporter,description,comment,created,updated,fixVersions,labels,project,parent,attachment') {
  return apiFetch(`/issue/${encodeURIComponent(key)}?fields=${fields}`, site);
}

// Cache of field id <-> name, per site (field ids/names are stable per Jira instance).
const fieldMetaCache = new Map();

async function getFieldMeta(site) {
  let meta = fieldMetaCache.get(site.siteUrl);
  if (!meta) {
    const allFields = await apiFetch('/field', site);
    // byNameAll: some Jira instances have multiple custom fields sharing the same display
    // name (duplicate field configs) - keep all ids per name so callers can pick the populated one.
    const byNameAll = new Map();
    for (const f of allFields) {
      if (!byNameAll.has(f.name)) byNameAll.set(f.name, []);
      byNameAll.get(f.name).push(f.id);
    }
    meta = { byNameAll, byId: new Map(allFields.map(f => [f.id, f.name])) };
    fieldMetaCache.set(site.siteUrl, meta);
  }
  return meta;
}

// Resolve all customfield_XXXXX ids matching a display name (e.g. "Developer Notes"). Returns a
// Map<name, fieldId[]> (empty array if not found). Results are cached per siteUrl.
export async function resolveFieldIds(site, names) {
  const { byNameAll } = await getFieldMeta(site);
  return new Map(names.map(name => [name, byNameAll.get(name) ?? []]));
}

// Resolve a customfield_XXXXX id back to its display name (e.g. "Developer Notes").
export async function resolveFieldName(site, id) {
  const { byId } = await getFieldMeta(site);
  return byId.get(id) ?? id;
}

export async function searchIssues(site, jql, { maxResults = 20, nextPageToken, fields = 'summary,status,assignee,priority,issuetype,updated,fixVersions' } = {}) {
  const body = { jql, maxResults: Math.min(Math.max(Math.trunc(maxResults), 1), 50), fields: fields.split(',') };
  if (nextPageToken) body.nextPageToken = nextPageToken;
  return apiFetch('/search/jql', site, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function createIssue(site, fields) {
  return apiFetch('/issue', site, { method: 'POST', body: JSON.stringify({ fields }) });
}

export async function updateIssue(site, key, fields) {
  return apiFetch(`/issue/${encodeURIComponent(key)}`, site, { method: 'PUT', body: JSON.stringify({ fields }) });
}

export async function addComment(site, key, body) {
  return apiFetch(`/issue/${encodeURIComponent(key)}/comment`, site, { method: 'POST', body: JSON.stringify({ body }) });
}

export async function getComments(site, key, { maxResults = 50 } = {}) {
  const limit = Math.min(Math.max(Math.trunc(maxResults), 1), 100);
  return apiFetch(`/issue/${encodeURIComponent(key)}/comment?maxResults=${limit}&orderBy=created`, site);
}

export async function updateComment(site, key, commentId, body) {
  return apiFetch(`/issue/${encodeURIComponent(key)}/comment/${encodeURIComponent(commentId)}`, site, {
    method: 'PUT',
    body: JSON.stringify({ body }),
  });
}

export async function getAttachments(site, key) {
  // Fetch just the attachment + comment fields; scan comments for referenced media IDs.
  const issue = await apiFetch(`/issue/${encodeURIComponent(key)}?fields=attachment,comment`, site);
  return issue.fields;
}

export async function readAttachment(site, id) {
  const url = `${BASE(site.siteUrl)}/attachment/content/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: { ...makeHeaders(site), 'Accept': '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msgs = data?.errorMessages?.length ? data.errorMessages.join('; ')
      : data?.message || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msgs);
  }
  const declaredSize = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte download limit.`);
  }
  if (!res.body) throw new Error('Attachment response did not contain a body.');
  const reader = res.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_ATTACHMENT_BYTES) {
      await reader.cancel();
      throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte download limit.`);
    }
    chunks.push(Buffer.from(value));
  }
  const mimeType = res.headers.get('content-type') || 'application/octet-stream';
  const buf = Buffer.concat(chunks, total);
  return { mimeType, base64: buf.toString('base64'), size: buf.length };
}

// Parse the filename from a Content-Disposition header, preferring RFC 5987 filename*.
function filenameFromContentDisposition(header) {
  if (!header) return null;
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try { return decodeURIComponent(star[1].trim().replace(/^"|"$/g, '')); } catch { /* fall through */ }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain ? plain[1].trim() : null;
}

// Keep only a safe basename so a server-supplied filename can never escape the target directory.
function safeBasename(name, fallback) {
  const base = basename(String(name || '').replace(/\\/g, '/'));
  const cleaned = base.replace(/[/\0]/g, '').trim();
  return cleaned && cleaned !== '.' && cleaned !== '..' ? cleaned : fallback;
}

// Stream a Jira attachment to a local file and return its absolute path (plus metadata).
// destPath: exact output file (absolute, or resolved from cwd). destDir: directory to place the
// attachment's own filename in. When neither is given, files land in os.tmpdir()/jira-mcp-attachments.
export async function downloadAttachment(site, id, { destPath, destDir } = {}) {
  const url = `${BASE(site.siteUrl)}/attachment/content/${encodeURIComponent(id)}`;
  const res = await fetch(url, {
    headers: { ...makeHeaders(site), 'Accept': '*/*' },
    redirect: 'follow',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    const msgs = data?.errorMessages?.length ? data.errorMessages.join('; ')
      : data?.message || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msgs);
  }
  const declaredSize = Number(res.headers.get('content-length'));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte download limit.`);
  }
  if (!res.body) throw new Error('Attachment response did not contain a body.');

  const mimeType = res.headers.get('content-type') || 'application/octet-stream';
  const filename = safeBasename(filenameFromContentDisposition(res.headers.get('content-disposition')), `attachment-${id}`);
  const outPath = destPath
    ? (isAbsolute(destPath) ? destPath : resolve(destPath))
    : join(destDir ? (isAbsolute(destDir) ? destDir : resolve(destDir)) : join(tmpdir(), 'jira-mcp-attachments'), filename);

  await mkdir(dirname(outPath), { recursive: true });
  const fh = await open(outPath, 'w');
  const reader = res.body.getReader();
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_ATTACHMENT_BYTES) {
        await reader.cancel();
        throw new Error(`Attachment exceeds the ${MAX_ATTACHMENT_BYTES}-byte download limit.`);
      }
      await fh.write(Buffer.from(value));
    }
  } catch (e) {
    await fh.close();
    await rm(outPath, { force: true }).catch(() => {});
    throw e;
  }
  await fh.close();
  return { path: outPath, mimeType, size: total, filename };
}

// Upload one or more local files as attachments on an issue. Jira requires the multipart field
// name "file" and the X-Atlassian-Token: no-check header; Content-Type must be left to fetch so
// the multipart boundary is generated correctly.
export async function uploadAttachments(site, key, filePaths) {
  const paths = (Array.isArray(filePaths) ? filePaths : [filePaths]).map(p => String(p));
  if (paths.length === 0) throw new Error('At least one file path is required.');

  const form = new FormData();
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : resolve(p);
    const info = await stat(abs).catch(() => null);
    if (!info) throw new Error(`File not found: ${abs}`);
    if (!info.isFile()) throw new Error(`Not a file: ${abs}`);
    if (info.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${basename(abs)} exceeds the ${MAX_ATTACHMENT_BYTES}-byte upload limit.`);
    }
    const buf = await readFile(abs);
    form.append('file', new Blob([buf]), basename(abs));
  }

  const { 'Content-Type': _ignored, ...headers } = makeHeaders(site);
  const url = `${BASE(site.siteUrl)}/issue/${encodeURIComponent(key)}/attachments`;
  const res = await fetch(url, {
    method: 'POST',
    body: form,
    headers: { ...headers, 'X-Atlassian-Token': 'no-check' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msgs = data?.errorMessages?.length ? data.errorMessages.join('; ')
      : data?.message || `HTTP ${res.status} ${res.statusText}`;
    throw new Error(msgs);
  }
  return Array.isArray(data) ? data : [];
}

// Recursively collect media/file attachment IDs referenced inside an ADF comment body.
export function collectMediaIds(node, acc = new Set()) {
  if (!node || typeof node !== 'object') return acc;
  if ((node.type === 'media' || node.type === 'file') && node.attrs?.id) acc.add(node.attrs.id);
  for (const child of node.content || []) collectMediaIds(child, acc);
  return acc;
}

export async function getTransitions(site, key) {
  return apiFetch(`/issue/${encodeURIComponent(key)}/transitions`, site);
}

export async function transitionIssue(site, key, transitionId, comment) {
  const body = { transition: { id: transitionId } };
  if (comment) {
    body.update = { comment: [{ add: { body: textToAdf(comment) } }] };
  }
  return apiFetch(`/issue/${encodeURIComponent(key)}/transitions`, site, { method: 'POST', body: JSON.stringify(body) });
}

export async function listProjects(site, query) {
  const qs = query ? `?query=${encodeURIComponent(query)}` : '';
  return apiFetch(`/project/search${qs}`, site);
}

export async function assignIssue(site, key, accountId) {
  return apiFetch(`/issue/${encodeURIComponent(key)}/assignee`, site, {
    method: 'PUT',
    body: JSON.stringify({ accountId: accountId || null }),
  });
}

// ─── ADF helpers ──────────────────────────────────────────────────────────────
// Build a resolver that maps an ADF media node to a Jira attachment (id + filename).
// Media nodes reference files by a media-services id (attrs.id) which sometimes equals
// the attachment id and otherwise is matched by filename (attrs.alt) against fields.attachment.
export function buildMediaResolver(attachments = []) {
  const byName = new Map(attachments.map(a => [a.filename, a]));
  return (mediaId, filename) => {
    const direct = attachments.find(a => String(a.id) === String(mediaId));
    if (direct) return { attachmentId: direct.id, filename: direct.filename };
    if (filename && byName.has(filename)) {
      const a = byName.get(filename);
      return { attachmentId: a.id, filename: a.filename };
    }
    return null;
  };
}

// ctx (optional): { resolve?: (mediaId, filename) => { attachmentId, filename } | null,
//                   media?: Array collecting { mediaId, filename } occurrences }
export function adfToText(node, ctx) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (node.type === 'hardBreak') return '\n';
  if (node.type === 'mention') return `@${node.attrs?.text || '?'}`;
  if (node.type === 'emoji') return node.attrs?.text || node.attrs?.shortName || '';
  if (node.type === 'inlineCard') return node.attrs?.url || '';
  if (node.type === 'media' || node.type === 'mediaInline') {
    const mediaId = node.attrs?.id;
    const filename = node.attrs?.alt || node.attrs?.title || '';
    if (ctx?.media) ctx.media.push({ mediaId, filename });
    const att = ctx?.resolve?.(mediaId, filename);
    if (att?.attachmentId != null) return `[a:id:${att.attachmentId}]`;
    if (mediaId) return `[media:${mediaId}${filename ? ` name:${filename}` : ''}]`;
    return '[Attachment]';
  }
  const children = (node.content || []).map(c => adfToText(c, ctx)).join('');
  switch (node.type) {
    case 'doc': return children.trim();
    case 'paragraph': return children + '\n';
    case 'heading': return '#'.repeat(node.attrs?.level || 1) + ' ' + children + '\n';
    case 'bulletList':
    case 'orderedList': return children;
    case 'listItem': return '• ' + children;
    case 'codeBlock': return '```' + (node.attrs?.language || '') + '\n' + children + '\n```\n';
    case 'blockquote': return children.split('\n').map(l => l ? '> ' + l : l).join('\n');
    case 'rule': return '---\n';
    case 'strong': return `**${children}**`;
    case 'em': return `_${children}_`;
    case 'code': return `\`${children}\``;
    case 'strike': return `~~${children}~~`;
    case 'tableRow': return '| ' + children + '\n';
    case 'tableCell':
    case 'tableHeader': return children + ' | ';
    case 'mediaSingle':
    case 'mediaGroup': return children + '\n';
    default: return children;
  }
}

// Normalize a comment body param into a valid ADF doc object.
// Accepts an ADF doc object ({ type:'doc', ... }) as-is, or a plain string → wrapped.
// Jira v3 REJECTS a bare string body, so everything is coerced to ADF here.
export function resolveCommentBody(body) {
  if (body && typeof body === 'object') {
    if (body.type !== 'doc') throw new Error("ADF body must be a document object: { version: 1, type: 'doc', content: [...] }");
    if (body.version == null) body = { ...body, version: 1 };
    if (!Array.isArray(body.content)) throw new Error('ADF doc must have a content array.');
    return body;
  }
  return textToAdf(String(body ?? ''));
}

export function textToAdf(text) {
  if (!text) return { type: 'doc', version: 1, content: [] };
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  return {
    type: 'doc',
    version: 1,
    content: paragraphs.length
      ? paragraphs.map(p => ({ type: 'paragraph', content: [{ type: 'text', text: p.trim() }] }))
      : [{ type: 'paragraph', content: [] }],
  };
}
