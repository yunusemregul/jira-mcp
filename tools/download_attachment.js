import { z } from 'zod';
import { downloadAttachment } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'download_attachment';

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const tool = {
  name: TOOL,
  category: 'read',
  description: 'Download a Jira attachment to a local file and return its absolute path, so the client can open or parse it directly (spreadsheets, PDFs, documents, archives) instead of decoding base64. By default the file is written to the OS temp directory under its original filename; pass destPath for an exact output file or destDir for a target directory. Use get_attachments to find the attachmentId. Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    attachmentId: z.string().describe('Attachment ID (from get_attachments)'),
    destPath: z.string().optional().describe('Exact output file path (absolute, or resolved from the server cwd). Overrides destDir and the original filename.'),
    destDir: z.string().optional().describe('Directory to save the attachment into, keeping its original filename. Defaults to the OS temp directory.'),
  },
  handler: async ({ siteId, attachmentId, destPath, destDir }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: `attachment ${attachmentId}` });
    try {
      const { path, mimeType, size, filename } = await downloadAttachment(site, attachmentId, { destPath, destDir });
      const out = [
        `Downloaded attachment ${attachmentId} (${filename})`,
        `  path: ${path}`,
        `  type: ${mimeType}  |  size: ${fmtSize(size)}`,
        '',
        'Open or parse this file directly from the path above.',
      ].join('\n');
      mcpLog({ tool: TOOL, siteName: site.name, preview: `${filename} -> ${path} (${fmtSize(size)})`, detail: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
