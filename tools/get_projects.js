import { z } from 'zod';
import { listProjects } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'get_projects';

export const tool = {
  name: TOOL,
  category: 'read',
  description: 'List Jira projects accessible to the authenticated user. Call list_sites first.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    query: z.string().optional().describe('Filter by project name or key'),
  },
  handler: async ({ siteId, query }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: query || 'all projects' });
    try {
      const data = await listProjects(site, query);
      const projects = data.values || [];
      const lines = [`Projects (${projects.length}):\n`];
      for (const p of projects) {
        lines.push(`  ${p.key.padEnd(12)} ${p.name} [${p.projectTypeKey}]`);
      }
      const out = lines.join('\n');
      mcpLog({ tool: TOOL, siteName: site.name, preview: `${projects.length} projects`, detail: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
