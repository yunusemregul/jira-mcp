import { z } from 'zod';
import { transitionIssue, getIssue } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'transition_issue';

export const tool = {
  name: TOOL,
  category: 'write',
  description: 'Move a Jira issue to a different status. Get transition IDs with get_transitions first.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    key: z.string().describe('Issue key, e.g. SCC-6087'),
    transitionId: z.string().describe('Transition ID from get_transitions'),
    comment: z.string().optional().describe('Optional comment to add when transitioning'),
  },
  handler: async ({ siteId, key, transitionId, comment }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: `${key} → transition ${transitionId}` });
    try {
      await transitionIssue(site, key, transitionId, comment);
      const issue = await getIssue(site, key, 'status');
      const newStatus = issue.fields.status?.name;
      const out = `${key} transitioned to: ${newStatus}`;
      mcpLog({ tool: TOOL, siteName: site.name, preview: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
