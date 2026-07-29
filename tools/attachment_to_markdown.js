import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { downloadAttachment } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'attachment_to_markdown';

const CONVERT_TIMEOUT_MS = Number(process.env.JIRA_MARKITDOWN_TIMEOUT_MS) || 120_000;
const MAX_OUTPUT_CHARS = Number(process.env.JIRA_MARKITDOWN_MAX_CHARS) || 200_000;

// Candidate commands for Microsoft markitdown, most direct first. JIRA_MARKITDOWN_CMD overrides the
// list with a single whitespace-separated command (e.g. "uvx markitdown" or "/path/to/markitdown").
export function converterCandidates() {
  const override = (process.env.JIRA_MARKITDOWN_CMD || '').trim();
  if (override) return [override.split(/\s+/)];
  return [['markitdown'], ['uvx', 'markitdown']];
}

// Spawn failures meaning "this command is not usable here" rather than "markitdown ran and failed".
const NOT_RUNNABLE = new Set(['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR']);

export const INSTALL_HINT = [
  'Install it on the machine running this server, either:',
  '  pip install "markitdown[all]"   (puts "markitdown" on PATH)',
  '  uv, so "uvx markitdown" can fetch it on demand',
  'Or set JIRA_MARKITDOWN_CMD to an existing install, e.g. JIRA_MARKITDOWN_CMD="/opt/venv/bin/markitdown".',
  'This affects only attachment_to_markdown; every other tool works without it.',
].join('\n');

function runConverter([cmd, ...baseArgs], filePath) {
  return new Promise((resolvePromise, reject) => {
    execFile(cmd, [...baseArgs, filePath], {
      timeout: CONVERT_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
      encoding: 'utf8',
    }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolvePromise(stdout);
    });
  });
}

export async function convertToMarkdown(filePath) {
  const attempts = [];
  for (const candidate of converterCandidates()) {
    const label = candidate.join(' ');
    try {
      return await runConverter(candidate, filePath);
    } catch (e) {
      // A command that could not be started at all just means this candidate is not installed here,
      // so fall through to the next one. Anything else came out of markitdown itself and is a real
      // conversion failure that retrying with another candidate cannot fix.
      if (NOT_RUNNABLE.has(e.code)) {
        attempts.push(`"${label}" (${e.code})`);
        continue;
      }
      if (e.killed) {
        throw new Error(`markitdown ("${label}") timed out after ${CONVERT_TIMEOUT_MS}ms. Raise JIRA_MARKITDOWN_TIMEOUT_MS if this attachment is large.`, { cause: e });
      }
      const detail = (e.stderr || e.message || '').trim();
      throw new Error(`markitdown ("${label}") failed to convert this attachment: ${detail || e.code || 'unknown error'}`, { cause: e });
    }
  }
  throw new Error(`markitdown is not available — tried ${attempts.join(', ')}.\n\n${INSTALL_HINT}`);
}

export const tool = {
  name: TOOL,
  category: 'read',
  description: 'Convert a Jira attachment to Markdown using Microsoft markitdown and return the text. Handles spreadsheets (xlsx), Word (docx), PowerPoint (pptx), PDF, HTML, CSV, and more, producing readable Markdown (tables preserved) instead of base64. Requires markitdown on the server (falls back to "uvx markitdown"). Use get_attachments to find the attachmentId. Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    attachmentId: z.string().describe('Attachment ID (from get_attachments)'),
  },
  handler: async ({ siteId, attachmentId }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: `attachment ${attachmentId}` });
    const dir = join(tmpdir(), 'jira-mcp-markitdown');
    let downloadedPath = null;
    try {
      const { path, filename, mimeType } = await downloadAttachment(site, attachmentId, { destDir: dir });
      downloadedPath = path;
      let markdown = await convertToMarkdown(path);
      let truncatedNote = '';
      if (markdown.length > MAX_OUTPUT_CHARS) {
        truncatedNote = `\n\n[Output truncated to ${MAX_OUTPUT_CHARS} characters of ${markdown.length}.]`;
        markdown = markdown.slice(0, MAX_OUTPUT_CHARS);
      }
      const out = `Attachment ${attachmentId} (${filename}, ${mimeType}) converted to Markdown:\n\n${markdown}${truncatedNote}`;
      mcpLog({ tool: TOOL, siteName: site.name, preview: `${filename} -> markdown (${markdown.length} chars)`, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    } finally {
      if (downloadedPath) await rm(downloadedPath, { force: true }).catch(() => {});
    }
  },
};
