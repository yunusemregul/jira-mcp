import { z } from 'zod';
import { readAttachment } from '../jira.js';
import { getSite, text, image, error, mcpLogStart, mcpLog } from './context.js';

const TOOL = 'read_attachment';

export const tool = {
  name: TOOL,
  category: 'read',
  description: 'Fetch a Jira attachment binary by attachmentId and return it as base64. Image attachments are returned inline so they can be viewed. Use get_attachments to find the attachmentId. Call list_sites first to get siteId.',
  inputSchema: {
    siteId: z.string().describe('Site ID from list_sites'),
    attachmentId: z.string().describe('Attachment ID (from get_attachments)'),
  },
  handler: async ({ siteId, attachmentId }) => {
    const site = await getSite(siteId);
    if (!site) return error(`Site "${siteId}" not found. Call list_sites to get valid IDs.`);

    const runId = mcpLogStart({ tool: TOOL, siteName: site.name, preview: `attachment ${attachmentId}` });
    try {
      const { mimeType, base64, size } = await readAttachment(site, attachmentId);
      mcpLog({ tool: TOOL, siteName: site.name, preview: `${mimeType} (${size} bytes)`, runId });
      if (mimeType.startsWith('image/')) {
        return image(base64, mimeType, `Attachment ${attachmentId} (${mimeType}, ${size} bytes)`);
      }
      // Non-image: return base64 payload as text so the client can decode it.
      return text(`Attachment ${attachmentId} (${mimeType}, ${size} bytes), base64:\n${base64}`);
    } catch (e) {
      mcpLog({ tool: TOOL, siteName: site.name, preview: `Error: ${e.message}`, isError: true, runId });
      return error(e.message);
    }
  },
};
