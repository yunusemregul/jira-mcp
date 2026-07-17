// ─── Theme ────────────────────────────────────────────────────────────────────
const THEME_KEY = 'jira-mcp-theme';
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  document.getElementById('btnTheme').textContent = t === 'dark' ? '☀' : '☾';
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  localStorage.setItem(THEME_KEY, next);
  applyTheme(next);
}
applyTheme(localStorage.getItem(THEME_KEY) || 'dark');

// ─── Toast ────────────────────────────────────────────────────────────────────
let toastTimer;
function toast(msg, type = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2800);
}

// ─── Copy ─────────────────────────────────────────────────────────────────────
function copyEl(id) {
  const el = document.getElementById(id);
  navigator.clipboard.writeText(el.textContent).then(() => toast('Copied!'));
}

// ─── Status bar ───────────────────────────────────────────────────────────────
const base = window.location.origin;
document.getElementById('infoEndpoint').textContent = `${base}/mcp`;
document.getElementById('infoCodexCmd').textContent = `codex mcp add jira-mcp --url ${base}/mcp`;
document.getElementById('infoClaudeCmd').textContent = `claude mcp add --transport sse jira-mcp ${base}/mcp/sse`;
document.getElementById('infoJson').textContent = JSON.stringify({ mcpServers: { 'jira-mcp': { url: `${base}/mcp` } } }, null, 2);
document.getElementById('modalCodexCmd').textContent = `codex mcp add jira-mcp --url ${base}/mcp`;
document.getElementById('modalClaudeCmd').textContent = `claude mcp add --transport sse jira-mcp ${base}/mcp/sse`;
document.getElementById('modalJson').textContent = JSON.stringify({ mcpServers: { 'jira-mcp': { url: `${base}/mcp` } } }, null, 2);

async function refreshStatus() {
  try {
    const s = await fetch('/api/status').then(r => r.json());
    const sc = s.siteCount ?? 0;
    const cc = s.connectedClients ?? 0;
    document.getElementById('siteLabel').textContent = `${sc} site${sc !== 1 ? 's' : ''}`;
    document.getElementById('clientLabel').textContent = `${cc} client${cc !== 1 ? 's' : ''}`;
    document.getElementById('siteDot').className = `status-dot ${sc ? 'active' : ''}`;
    document.getElementById('clientDot').className = `status-dot ${cc ? 'active' : ''}`;
  } catch (_) {}
}
setInterval(refreshStatus, 5000);
refreshStatus();

// ─── Site list ────────────────────────────────────────────────────────────────
let sites = [];
const connStates = {};

async function loadSites() {
  sites = await fetch('/api/sites').then(r => r.json());
  renderSites();
  refreshStatus();
  sites.forEach(s => { if (connStates[s.id] === undefined) testSite(s.id); });
}

function renderSites() {
  const el = document.getElementById('siteList');
  if (!sites.length) {
    el.innerHTML = '<div class="empty">No sites configured yet.<br/>Click <strong>+ Add Site</strong> to get started.</div>';
    return;
  }
  el.innerHTML = sites.map(s => {
    const state = connStates[s.id] ?? 'testing';
    const dotClass = state === 'ok' ? 'active' : state === 'testing' ? 'testing' : 'inactive';
    const connLabel = state === 'testing' ? 'Connecting…' : state === 'ok' ? 'Connected' : 'Connection failed';
    return `<div class="ws-item">
      <div class="ws-dot ${dotClass}"></div>
      <div class="ws-info">
        <div class="ws-name">${esc(s.name)}</div>
        <div class="ws-slug">${esc(s.siteUrl)} · ${esc(s.username)}</div>
      </div>
      <div class="conn-status ${state}"><div class="conn-dot"></div>${connLabel}</div>
      <div class="ws-actions">
        <button class="btn-edit btn-sm" onclick="editSite('${s.id}')">Edit</button>
      </div>
    </div>`;
  }).join('');
}

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

async function testSite(id) {
  connStates[id] = 'testing';
  renderSites();
  try {
    const r = await fetch(`/api/sites/${id}/test`, { method: 'POST' }).then(r => r.json());
    connStates[id] = r.ok ? 'ok' : 'err';
  } catch (_) {
    connStates[id] = 'err';
  }
  renderSites();
}

// ─── Form ─────────────────────────────────────────────────────────────────────
function openForm(site = null) {
  document.getElementById('editId').value = site?.id ?? '';
  document.getElementById('formTitle').textContent = site ? 'Edit Site' : 'Add Site';
  document.getElementById('fUrl').value = site?.siteUrl ?? '';
  document.getElementById('fName').value = site?.name ?? '';
  document.getElementById('fUser').value = site?.username ?? '';
  const tokenInput = document.getElementById('fToken');
  tokenInput.value = '';
  tokenInput.placeholder = site?.hasToken ? 'Leave blank to keep the saved token' : '••••••••••••••••';
  document.getElementById('btnDelete').style.display = site ? '' : 'none';
  clearFieldErrors();
  hideConnTestStatus();
  document.getElementById('formOverlay').classList.add('visible');
  setTimeout(() => document.getElementById('fUrl').focus(), 100);
}

function editSite(id) { openForm(sites.find(s => s.id === id)); }

let deleteConfirmTimer = null;
let deleteCountdownInterval = null;

function resetDeleteBtn() {
  clearTimeout(deleteConfirmTimer);
  clearInterval(deleteCountdownInterval);
  const btn = document.getElementById('btnDelete');
  btn.dataset.confirming = '';
  btn.textContent = 'Delete';
  btn.classList.remove('btn-del-confirm');
}

async function deleteCurrentSite() {
  const btn = document.getElementById('btnDelete');
  if (btn.dataset.confirming !== '1') {
    btn.dataset.confirming = '1';
    btn.classList.add('btn-del-confirm');
    let secs = 3;
    btn.textContent = `Click again to delete (${secs})`;
    deleteCountdownInterval = setInterval(() => {
      secs--;
      if (secs <= 0) resetDeleteBtn();
      else btn.textContent = `Click again to delete (${secs})`;
    }, 1000);
    deleteConfirmTimer = setTimeout(resetDeleteBtn, 3000);
    return;
  }
  resetDeleteBtn();
  const id = document.getElementById('editId').value;
  await fetch(`/api/sites/${id}`, { method: 'DELETE' });
  delete connStates[id];
  closeForm();
  toast('Site deleted');
  loadSites();
}

function closeForm() {
  document.getElementById('formOverlay').classList.remove('visible');
  resetDeleteBtn();
}

function closeFormModal(e) {
  if (e.target === document.getElementById('formOverlay')) closeForm();
}

function clearFieldErrors() {
  ['Url', 'Name', 'User', 'Token'].forEach(f => {
    document.getElementById(`err${f}`).style.display = 'none';
    document.getElementById(`f${f}`).classList.remove('input-err');
  });
}

function fieldErr(field, msg) {
  document.getElementById(`err${field}`).textContent = msg;
  document.getElementById(`err${field}`).style.display = 'block';
  document.getElementById(`f${field}`).classList.add('input-err');
}

function toggleTokenVisibility() {
  const input = document.getElementById('fToken');
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  document.getElementById('eyeIcon').style.display = isPassword ? 'none' : '';
  document.getElementById('eyeOffIcon').style.display = isPassword ? '' : 'none';
}

function hideConnTestStatus() {
  document.getElementById('connTestStatus').style.display = 'none';
}

function showConnTestStatus(msg, cls) {
  const el = document.getElementById('connTestStatus');
  el.className = `url-status ${cls}`;
  el.textContent = msg;
  el.style.display = 'block';
}

function getFormValues() {
  return {
    siteUrl: document.getElementById('fUrl').value.trim().replace(/\/$/, ''),
    name: document.getElementById('fName').value.trim(),
    username: document.getElementById('fUser').value.trim(),
    token: document.getElementById('fToken').value.trim(),
  };
}

function validateForm(v, requireToken) {
  let ok = true;
  clearFieldErrors();
  if (!v.siteUrl) { fieldErr('Url', 'Site URL is required'); ok = false; }
  if (!v.name) { fieldErr('Name', 'Name is required'); ok = false; }
  if (!v.username) { fieldErr('User', 'Email is required'); ok = false; }
  if (requireToken && !v.token) { fieldErr('Token', 'API token is required'); ok = false; }
  return ok;
}

async function testConn() {
  const v = getFormValues();
  const editId = document.getElementById('editId').value;
  if (!validateForm(v, !editId)) return;
  showConnTestStatus('Testing connection…', 'testing');
  try {
    const useSavedToken = editId && !v.token;
    const r = await fetch(useSavedToken ? `/api/sites/${editId}/test` : '/api/test-connection', {
      method: 'POST',
      ...(useSavedToken ? {} : {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(v),
      }),
    }).then(r => r.json());
    if (r.ok) showConnTestStatus('Connection successful!', 'ok');
    else showConnTestStatus(`Failed: ${r.error}`, 'err');
  } catch (_) {
    showConnTestStatus('Network error', 'err');
  }
}

async function saveSite() {
  const v = getFormValues();
  const editId = document.getElementById('editId').value;
  const isEdit = !!editId;
  if (!validateForm(v, !isEdit)) return;

  const payload = { name: v.name, siteUrl: v.siteUrl, username: v.username };
  if (v.token) payload.token = v.token;

  document.getElementById('btnSave').disabled = true;
  try {
    if (isEdit) {
      const response = await fetch(`/api/sites/${editId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Update failed');
      toast('Site updated');
      delete connStates[editId];
    } else {
      const response = await fetch('/api/sites', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) throw new Error((await response.json()).error || 'Save failed');
      toast('Site added');
    }
    closeForm();
    loadSites();
  } catch (_) {
    toast('Save failed', 'err');
  }
  document.getElementById('btnSave').disabled = false;
}

// ─── Setup modal ──────────────────────────────────────────────────────────────
const MODAL_KEY = 'jira-mcp-modal-dismissed';
function showModal() { document.getElementById('modalOverlay').classList.add('visible'); }
function closeModal(e) { if (e.target === document.getElementById('modalOverlay')) dismissModal(); }
function dismissModal() {
  localStorage.setItem(MODAL_KEY, '1');
  document.getElementById('modalOverlay').classList.remove('visible');
}
if (!localStorage.getItem(MODAL_KEY)) showModal();

// ─── Manifest modal ───────────────────────────────────────────────────────────
async function showManifest() {
  const m = await fetch('/api/manifest').then(r => r.json());
  const byCategory = {};
  for (const t of m.tools) {
    (byCategory[t.category] = byCategory[t.category] ?? []).push(t);
  }
  const catLabel = { read: 'Read', write: 'Write', util: 'Utility' };
  document.getElementById('manifestTools').innerHTML = Object.entries(byCategory).map(([cat, tools]) => `
    <div class="manifest-section">
      <div class="manifest-section-title">${catLabel[cat] ?? cat}</div>
      ${tools.map(t => `
        <div class="manifest-tool">
          <div class="manifest-tool-header">
            <span class="manifest-tool-name">${t.name}</span>
            <span class="manifest-cat cat-${cat}">${cat}</span>
          </div>
          <div class="manifest-tool-desc">${esc(t.description)}</div>
          ${t.params?.length ? `<div class="manifest-params">${t.params.map(p => `
            <div class="manifest-param">
              <span class="manifest-param-name">${p.name}${p.optional ? '?' : ''}</span>
              <span class="manifest-param-desc">${esc(p.description ?? '')}</span>
            </div>`).join('')}</div>` : ''}
        </div>`).join('')}
    </div>`).join('');
  document.getElementById('manifestOverlay').classList.add('visible');
}
function closeManifest() { document.getElementById('manifestOverlay').classList.remove('visible'); }
function closeManifestModal(e) { if (e.target === document.getElementById('manifestOverlay')) closeManifest(); }

// ─── MCP Activity Log SSE ─────────────────────────────────────────────────────
const logEntries = [];
const logDot = document.getElementById('logDot');

const es = new EventSource('/api/mcp-log');
es.onopen = () => logDot.classList.add('connected');
es.onerror = () => logDot.classList.remove('connected');
es.onmessage = e => {
  const entry = JSON.parse(e.data);
  const idx = logEntries.findIndex(x => x.id === entry.id);
  if (idx !== -1) logEntries[idx] = entry;
  else logEntries.unshift(entry);
  if (logEntries.length > 100) logEntries.pop();
  renderLog();
};

function clearLog() {
  logEntries.length = 0;
  renderLog();
}

function toolCategory(name) {
  const tool = (name ?? '').replace(/_/g, '');
  const writes = ['createissue', 'updateissue', 'addcomment', 'transitionissue'];
  const utils = ['listsites'];
  if (writes.includes(tool)) return 'write';
  if (utils.includes(tool)) return 'util';
  return 'read';
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function renderLog() {
  const el = document.getElementById('logList');
  if (!logEntries.length) {
    el.innerHTML = '<div class="empty" style="padding:20px">No activity yet.</div>';
    return;
  }
  el.innerHTML = logEntries.map(entry => {
    if (entry.type === 'system') {
      return `<div class="log-entry">
        <div class="log-summary log-summary-system">
          <span class="log-sys-dot"></span>
          <span class="log-preview">${esc(entry.client)} — ${esc(entry.preview)}</span>
          <span class="log-time">${fmtTime(entry.ts)}</span>
        </div>
      </div>`;
    }
    const running = entry.type === 'start';
    const cat = toolCategory(entry.tool);
    const cls = entry.isError ? 'err' : cat === 'write' ? 'write' : cat === 'util' ? 'util' : 'read';
    return `<div class="log-entry${running ? ' running' : ''}" id="log-${entry.id}">
      <div class="log-summary" onclick="toggleLog(${entry.id})">
        <span class="log-tool ${cls}">${esc(entry.tool)}</span>
        ${entry.siteName ? `<span class="log-env">${esc(entry.siteName)}</span>` : ''}
        <span class="log-preview">${esc(entry.preview)}</span>
        <span class="log-time">${fmtTime(entry.ts)}</span>
        <span class="log-chevron">›</span>
      </div>
      ${entry.detail ? `<div class="log-detail"><pre>${esc(entry.detail)}</pre></div>` : ''}
    </div>`;
  }).join('');
}

function toggleLog(id) {
  document.getElementById(`log-${id}`)?.classList.toggle('open');
}

// ─── Init ─────────────────────────────────────────────────────────────────────
loadSites();
