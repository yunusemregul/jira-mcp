import { z } from 'zod';
import { uploadAttachments } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'upload_attachment';

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const tool = {
  name: TOOL,
  category: 'write',
  description: 'Upload one or more local files as attachments on a Jira issue (screenshots, logs, documents). Pass absolute paths in filePaths; each file keeps its own basename as the attachment filename. Returns the created attachment ids, which can be embedded in an ADF comment as media nodes. Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    key: z.string().describe('Issue key, e.g. SCC-6087'),
    filePaths: z.array(z.string()).min(1).describe('Absolute paths of the files to upload (relative paths resolve from the server cwd)'),
  },
  handler: async ({ siteId, key, filePaths }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: `${key}: ${filePaths.length} file(s)` });
    try {
      const uploaded = await uploadAttachments(site, key, filePaths);
      const lines = uploaded.map(a => `  ${a.filename}  id: ${a.id}  |  ${a.mimeType}  |  ${fmtSize(Number(a.size))}`);
      const out = [`Uploaded ${uploaded.length} attachment(s) to ${key}`, ...lines].join('\n');
      mcpLog({ tool: TOOL, siteName: site.name, preview: `${key}: ${uploaded.map(a => a.filename).join(', ')}`, detail: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
