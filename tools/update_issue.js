import { z } from 'zod';
import { updateIssue, textToAdf } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'update_issue';

export const tool = {
  name: TOOL,
  category: 'write',
  description: 'Update fields on a Jira issue (summary, description, priority, assignee, labels). Call list_sites first.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    key: z.string().describe('Issue key, e.g. SCC-6087'),
    summary: z.string().optional().describe('New summary'),
    description: z.string().optional().describe('New description (plain text)'),
    priority: z.string().optional().describe('Priority: Highest, High, Medium, Low, Lowest'),
    assigneeAccountId: z.string().optional().describe('Account ID of new assignee, or empty string to unassign'),
    labels: z.array(z.string()).optional().describe('Replace all labels with this list'),
  },
  handler: async ({ siteId, key, summary, description, priority, assigneeAccountId, labels }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: key });
    try {
      const fields = {};
      if (summary !== undefined) fields.summary = summary;
      if (description !== undefined) fields.description = textToAdf(description);
      if (priority !== undefined) fields.priority = { name: priority };
      if (assigneeAccountId !== undefined) fields.assignee = assigneeAccountId ? { accountId: assigneeAccountId } : null;
      if (labels !== undefined) fields.labels = labels;

      await updateIssue(site, key, fields);
      const out = `Updated ${key}: ${Object.keys(fields).join(', ')}`;
      mcpLog({ tool: TOOL, siteName: site.name, preview: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
