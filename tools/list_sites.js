import { listSites } from '../storage.js';
import { text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'list_sites';

export const tool = {
  name: TOOL,
  category: 'utility',
  description: 'List all configured Jira sites. Call this first to get siteId values required by other tools.',
  inputSchema: {},
  handler: async () => {
    const runId = mcpLogStart({ tool: TOOL, preview: 'listing sites' });
    try {
      const sites = await listSites();
      if (!sites.length) {
        mcpLog({ tool: TOOL, preview: 'no sites', runId });
        return text('No Jira sites configured. Add one via the Jira MCP web UI.');
      }
      const lines = sites.map(s => `- **${s.name}** (id: \`${s.id}\`) — ${s.siteUrl}`);
      mcpLog({ tool: TOOL, preview: `${sites.length} site(s)`, runId });
      return text(`Configured Jira sites:\n\n${lines.join('\n')}`);
    } catch (e) {
      mcpLog({ tool: TOOL, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
