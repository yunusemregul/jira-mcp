import { chmod, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { randomBytes, randomUUID } from 'crypto';
import { join } from 'path';
import { homedir } from 'os';

const DATA_DIR = process.env.JIRA_MCP_DATA_DIR || join(homedir(), '.jira-mcp');
const FILE = join(DATA_DIR, 'sites.json');

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true, mode: 0o700 });
  await chmod(DATA_DIR, 0o700);
}

async function load() {
  if (!existsSync(FILE)) return [];
  return JSON.parse(await readFile(FILE, 'utf8'));
}

async function save(sites) {
  await ensureDataDir();
  const temporaryFile = join(DATA_DIR, `.sites-${process.pid}-${randomUUID()}.tmp`);
  await writeFile(temporaryFile, `${JSON.stringify(sites, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryFile, FILE);
  await chmod(FILE, 0o600);
}

export async function listSites() {
  return load();
}

export async function getSite(id) {
  return (await load()).find(s => s.id === id) ?? null;
}

export async function createSite(data) {
  const sites = await load();
  let id;
  do { id = randomBytes(4).toString('hex'); } while (sites.some(s => s.id === id));
  const site = { id, ...data };
  sites.push(site);
  await save(sites);
  return site;
}

export async function updateSite(id, data) {
  const sites = await load();
  const i = sites.findIndex(s => s.id === id);
  if (i === -1) throw new Error('Site not found');
  sites[i] = { ...sites[i], ...data };
  await save(sites);
  return sites[i];
}

export async function deleteSite(id) {
  const sites = await load();
  await save(sites.filter(s => s.id !== id));
}
