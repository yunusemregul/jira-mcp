import { z } from 'zod';
import { getAttachments, collectMediaIds } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'get_attachments';

function fmtSize(bytes) {
  if (!Number.isFinite(bytes)) return '?';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const tool = {
  name: TOOL,
  category: 'read',
  description: 'List attachments on a Jira issue (often images). Returns each attachment id, filename, mimeType, size, and content URL. Also surfaces media IDs referenced inside comments. Use read_attachment with an id to view the binary. Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    key: z.string().describe('Issue key, e.g. SCC-6087'),
  },
  handler: async ({ siteId, key }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: key });
    try {
      const fields = await getAttachments(site, key);
      const attachments = fields.attachment || [];

      // Media referenced inside comment ADF bodies (Jira "media" nodes) — surface their IDs.
      const referenced = new Set();
      for (const c of fields.comment?.comments || []) collectMediaIds(c.body, referenced);

      const lines = [];
      if (attachments.length) {
        lines.push(`Attachments on ${key} (${attachments.length}):`, '');
        for (const a of attachments) {
          lines.push(`• ${a.filename}`);
          lines.push(`    id: ${a.id}  |  ${a.mimeType || 'unknown'}  |  ${fmtSize(a.size)}`);
          lines.push(`    content: ${a.content}`);
        }
      } else {
        lines.push(`No file attachments on ${key}.`);
      }
      if (referenced.size) {
        lines.push('', `Media IDs referenced in comments: ${[...referenced].join(', ')}`);
      }
      lines.push('', 'Use read_attachment with an id to view an attachment inline.');

      const out = lines.join('\n');
      mcpLog({ tool: TOOL, siteName: site.name, preview: `${attachments.length} attachments on ${key}`, detail: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
