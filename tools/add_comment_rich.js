import { z } from 'zod';
import { addComment, resolveCommentBody } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'add_comment_rich';

export const tool = {
  name: TOOL,
  category: 'write',
  description:
    'Add a richly-formatted (ADF) comment to a Jira issue. Pass a full Atlassian Document Format doc as `adf` — { "version": 1, "type": "doc", "content": [...] } — supporting tables, panels, code blocks, colored text, mentions, task lists, etc. For plain text, use add_comment instead. Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    key: z.string().describe('Issue key, e.g. SCC-6087'),
    adf: z
      .object({
        version: z.number().optional().describe('ADF version (defaults to 1)'),
        type: z.literal('doc').describe("Must be 'doc'"),
        content: z.array(z.any()).describe('Array of ADF block nodes'),
      })
      .passthrough()
      .describe('ADF document object, e.g. { version: 1, type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "hi" }] }] }'),
  },
  handler: async ({ siteId, key, adf }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: `${key}: rich comment` });
    try {
      const body = resolveCommentBody(adf);
      const result = await addComment(site, key, body);
      const out = `Rich comment added to ${key} (id: ${result.id})`;
      mcpLog({ tool: TOOL, siteName: site.name, preview: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
