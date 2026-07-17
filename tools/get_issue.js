import { z } from 'zod';
import { getIssue, adfToText, buildMediaResolver, resolveFieldIds, resolveFieldName } from '../jira.js';
import { getSite, text, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'get_issue';

export const tool = {
  name: TOOL,
  category: 'read',
  description: 'Get full details of a Jira issue (summary, description, status, assignee, comments, etc.). Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    key: z.string().describe('Issue key, e.g. SCC-6087'),
  },
  handler: async ({ siteId, key }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: key });
    try {
      const customNames = ['Developer Notes', 'QA Notes'];
      const fieldIds = await resolveFieldIds(site, customNames);
      const issue = await getIssue(site, key, '*all');
      const f = issue.fields;
      const ctx = { resolve: buildMediaResolver(f.attachment || []) };

      const lines = [
        `${issue.key}: ${f.summary}`,
        `Status: ${f.status?.name}  |  Type: ${f.issuetype?.name}  |  Priority: ${f.priority?.name || 'None'}`,
        `Assignee: ${f.assignee?.displayName || 'Unassigned'}  |  Reporter: ${f.reporter?.displayName || 'Unknown'}`,
      ];
      if (f.parent) lines.push(`Parent: ${f.parent.key}: ${f.parent.fields?.summary || ''}`);
      if (f.fixVersions?.length) lines.push(`Fix Version: ${f.fixVersions.map(v => v.name).join(', ')}`);
      if (f.labels?.length) lines.push(`Labels: ${f.labels.join(', ')}`);
      lines.push(`Created: ${f.created?.slice(0, 10)}  |  Updated: ${f.updated?.slice(0, 10)}`);
      if (f.description) {
        const desc = adfToText(f.description, ctx).trim();
        if (desc) lines.push('', 'Description:', desc);
      }
      const shownIds = new Set(['description', 'comment', 'attachment']);
      for (const name of customNames) {
        const candidateIds = fieldIds.get(name) || [];
        candidateIds.forEach(id => shownIds.add(id));
        // Duplicate field configs sharing this name can exist; use whichever candidate has content.
        const populatedId = candidateIds.find(id => f[id] != null && f[id] !== '');
        const value = populatedId != null ? f[populatedId] : undefined;
        const rendered = value ? (typeof value === 'string' ? value.trim() : adfToText(value, ctx).trim()) : '';
        lines.push('', `${name}:`, rendered || '(empty)');
      }

      // Any other populated custom field with plain-text/ADF content (skip user/option/array picker fields).
      const otherCustom = Object.entries(f)
        .filter(([id, value]) => id.startsWith('customfield_') && !shownIds.has(id) && value != null
          && (typeof value === 'string' || (typeof value === 'object' && value.type === 'doc')))
        .map(([id, value]) => [id, typeof value === 'string' ? value.trim() : adfToText(value, ctx).trim()])
        .filter(([, rendered]) => rendered);
      if (otherCustom.length) {
        lines.push('', 'Other fields:');
        for (const [id, rendered] of otherCustom) {
          const name = await resolveFieldName(site, id);
          lines.push(`${name}: ${rendered}`);
        }
      }

      if (f.comment?.comments?.length) {
        lines.push('', `Comments (${f.comment.total}):`);
        for (const c of f.comment.comments) {
          lines.push('─────────────');
          lines.push(`[${c.created?.slice(0, 10)}] ${c.author?.displayName}:`);
          lines.push(adfToText(c.body, ctx).trim());
        }
      }
      if (f.attachment?.length) {
        lines.push('', `Attachments (${f.attachment.length}): use read_attachment with the id, or [a:id:<id>] placeholders above.`);
        for (const a of f.attachment) lines.push(`  [a:id:${a.id}] ${a.filename} (${a.mimeType})`);
      }
      const out = lines.join('\n');
      mcpLog({ tool: TOOL, siteName: site.name, preview: `${key}: ${f.summary}`, detail: out, runId });
      return text(out);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
