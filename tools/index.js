import { z } from 'zod';
import { callCtx } from './context.js';
import { tool as getIssue } from './get_issue.js';
import { tool as searchIssues } from './search_issues.js';
import { tool as createIssue } from './create_issue.js';
import { tool as updateIssue } from './update_issue.js';
import { tool as addComment } from './add_comment.js';
import { tool as addCommentRich } from './add_comment_rich.js';
import { tool as getComments } from './get_comments.js';
import { tool as updateComment } from './update_comment.js';
import { tool as getAttachments } from './get_attachments.js';
import { tool as readAttachment } from './read_attachment.js';
import { tool as downloadAttachment } from './download_attachment.js';
import { tool as attachmentToMarkdown } from './attachment_to_markdown.js';
import { tool as uploadAttachment } from './upload_attachment.js';
import { tool as getTransitions } from './get_transitions.js';
import { tool as transitionIssue } from './transition_issue.js';
import { tool as getProjects } from './get_projects.js';
import { tool as listSites } from './list_sites.js';

export const tools = [
  listSites,
  getIssue,
  searchIssues,
  createIssue,
  updateIssue,
  addComment,
  addCommentRich,
  getComments,
  updateComment,
  getAttachments,
  readAttachment,
  downloadAttachment,
  attachmentToMarkdown,
  uploadAttachment,
  getTransitions,
  transitionIssue,
  getProjects,
];

export function registerAllTools(mcp, getClientLabel) {
  for (const { name, description, handler, inputSchema } of tools) {
    mcp.registerTool(name, { description, inputSchema: z.object(inputSchema ?? {}) }, (args, extra) => {
      const client = getClientLabel?.(extra?.sessionId) ?? null;
      return callCtx.run({ client }, () => handler(args, extra));
    });
  }
}
