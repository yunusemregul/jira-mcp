import { z } from 'zod';
import { addComment, textToAdf } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'add_comment';

export const tool = {
  name: TOOL,
  category: 'write',
  description: 'Add a comment to a Jira issue. Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    key: z.string().describe('Issue key, e.g. SCC-6087'),
    body: z.string().describe('Comment text (plain text)'),
  },
  handler: async ({ siteId, key, body }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: `${key}: ${body.slice(0, 60)}` });
    try {
      const result = await addComment(site, key, textToAdf(body));
      const out = `Comment added to ${key} (id: ${result.id})`;
      mcpLog({ tool: TOOL, siteName: site.name, preview: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
