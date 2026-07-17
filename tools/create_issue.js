import { z } from 'zod';
import { createIssue, textToAdf } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'create_issue';

export const tool = {
  name: TOOL,
  category: 'write',
  description: 'Create a new Jira issue. Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    projectKey: z.string().describe('Project key, e.g. SCC'),
    summary: z.string().describe('Issue summary/title'),
    issueType: z.string().optional().describe('Issue type: Story, Bug, Task, Sub-task (default: Task)'),
    description: z.string().optional().describe('Issue description (plain text)'),
    priority: z.string().optional().describe('Priority: Highest, High, Medium, Low, Lowest'),
    assigneeAccountId: z.string().optional().describe('Atlassian account ID of the assignee'),
    labels: z.array(z.string()).optional().describe('Labels to add'),
  },
  handler: async ({ siteId, projectKey, summary, issueType = 'Task', description, priority, assigneeAccountId, labels }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: `${projectKey}: ${summary}` });
    try {
      const fields = { project: { key: projectKey }, summary, issuetype: { name: issueType } };
      if (description) fields.description = textToAdf(description);
      if (priority) fields.priority = { name: priority };
      if (assigneeAccountId) fields.assignee = { accountId: assigneeAccountId };
      if (labels?.length) fields.labels = labels;

      const result = await createIssue(site, fields);
      const out = `Created: ${result.key}\nURL: ${site.siteUrl}/browse/${result.key}`;
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Created ${result.key}`, detail: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
