import { z } from 'zod';
import { searchIssues } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'search_issues';

export const tool = {
  name: TOOL,
  category: 'read',
  description: 'Search Jira issues with JQL. Returns key, summary, status, assignee, priority. Call list_sites first.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    jql: z.string().describe('JQL query, e.g. "project = SCC AND assignee = currentUser() ORDER BY updated DESC"'),
    maxResults: z.number().optional().describe('Max results to return (default 20, max 50)'),
    nextPageToken: z.string().optional().describe('Opaque token returned by the previous page'),
  },
  handler: async ({ siteId, jql, maxResults = 20, nextPageToken }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: jql });
    try {
      const data = await searchIssues(site, jql, { maxResults, nextPageToken });
      const issues = data.issues ?? [];
      const lines = [`Found ${issues.length} issue(s) on this page:\n`];
      for (const issue of issues) {
        const f = issue.fields;
        lines.push(`${issue.key}  [${f.status?.name}]  ${f.priority?.name || '—'}  ${f.assignee?.displayName || 'Unassigned'}`);
        lines.push(`  ${f.summary}`);
        lines.push('');
      }
      if (!data.isLast && data.nextPageToken) {
        lines.push(`More results are available. Call search_issues again with nextPageToken: ${data.nextPageToken}`);
      }
      const out = lines.join('\n').trim();
      mcpLog({ tool: TOOL, siteName: site.name, preview: `${issues.length} result(s)`, detail: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
