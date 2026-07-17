import { z } from 'zod';
import { getTransitions } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'get_transitions';

export const tool = {
  name: TOOL,
  category: 'read',
  description: 'Get available status transitions for a Jira issue. Use the IDs with transition_issue.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    key: z.string().describe('Issue key, e.g. SCC-6087'),
  },
  handler: async ({ siteId, key }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: key });
    try {
      const data = await getTransitions(site, key);
      const lines = [`Available transitions for ${key}:\n`];
      for (const t of data.transitions) {
        lines.push(`  id: ${t.id}  →  ${t.to?.name} (${t.name})`);
      }
      const out = lines.join('\n');
      mcpLog({ tool: TOOL, siteName: site.name, preview: `${data.transitions.length} transitions for ${key}`, detail: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
