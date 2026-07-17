import { z } from 'zod';
import { updateComment, resolveCommentBody } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'update_comment';

export const tool = {
  name: TOOL,
  category: 'write',
  description:
    'Edit an existing comment on a Jira issue (PUT). Provide either `body` (plain text) or `adf` (a rich Atlassian Document Format doc, same handling as add_comment_rich); the given content replaces the existing comment. Use get_comments to find the commentId. Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    key: z.string().describe('Issue key, e.g. SCC-6087'),
    commentId: z.string().describe('Comment ID (from get_comments)'),
    body: z.string().optional().describe('New comment text (plain text) — replaces the existing content. Omit if using adf.'),
    adf: z
      .object({
        version: z.number().optional().describe('ADF version (defaults to 1)'),
        type: z.literal('doc').describe("Must be 'doc'"),
        content: z.array(z.any()).describe('Array of ADF block nodes'),
      })
      .passthrough()
      .optional()
      .describe('Rich ADF document object; replaces the comment content. Takes precedence over body.'),
  },
  handler: async ({ siteId, key, commentId, body, adf }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    if (adf == null && body == null) return error('Provide either `body` (plain text) or `adf` (ADF doc).');

    const preview = adf ? 'rich comment' : String(body).slice(0, 60);
    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: `${key}#${commentId}: ${preview}` });
    try {
      const resolved = resolveCommentBody(adf ?? body);
      const result = await updateComment(site, key, commentId, resolved);
      const out = `Comment ${result.id} on ${key} updated`;
      mcpLog({ tool: TOOL, siteName: site.name, preview: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
