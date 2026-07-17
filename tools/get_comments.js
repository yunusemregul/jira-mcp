import { z } from 'zod';
import { getComments, adfToText } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'get_comments';

export const tool = {
  name: TOOL,
  category: 'read',
  description: 'Get all comments on a Jira issue. Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    key: z.string().describe('Issue key, e.g. SCC-6087'),
    maxResults: z.number().optional().describe('Max comments to return (default 50)'),
  },
  handler: async ({ siteId, key, maxResults = 50 }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: key });
    try {
      const data = await getComments(site, key, { maxResults });
      if (!data.comments?.length) {
        mcpLog({ tool: TOOL, siteName: site.name, preview: `No comments on ${key}`, runId });
        return text(`No comments on ${key}.`);
      }
      const ctx = { media: [] };
      const lines = [`Comments on ${key} (${data.total} total):\n`];
      for (const c of data.comments) {
        lines.push(`[${c.created?.slice(0, 10)}] ${c.author?.displayName} (id: ${c.id})`);
        lines.push(adfToText(c.body, ctx).trim());
        lines.push('');
      }
      if (ctx.media.length) {
        const seen = new Map();
        for (const m of ctx.media) if (m.mediaId && !seen.has(m.mediaId)) seen.set(m.mediaId, m.filename);
        lines.push('Inline media referenced above ([media:<id> name:<file>]):');
        for (const [id, name] of seen) lines.push(`  media:${id}${name ? ` name:${name}` : ''}`);
        lines.push('Use get_attachments to map these to attachment ids, then read_attachment to view.');
      }
      const out = lines.join('\n').trim();
      mcpLog({ tool: TOOL, siteName: site.name, preview: `${data.total} comments on ${key}`, detail: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
