import assert from 'node:assert/strict';
import test from 'node:test';
import { collectMediaIds, normalizeSiteUrl, searchIssues, textToAdf } from '../jira.js';

const site = {
  siteUrl: 'https://example.atlassian.net',
  username: 'user@example.com',
  token: 'test-token',
};

test('searchIssues uses enhanced JQL search and token pagination', async t => {
  const originalFetch = globalThis.fetch;
  let request;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return Response.json({ issues: [], isLast: true });
  };

  await searchIssues(site, 'project = TEST', { maxResults: 200, nextPageToken: 'next-1' });

  assert.equal(request.url, 'https://example.atlassian.net/rest/api/3/search/jql');
  assert.equal(request.options.method, 'POST');
  assert.deepEqual(JSON.parse(request.options.body), {
    jql: 'project = TEST',
    maxResults: 50,
    fields: ['summary', 'status', 'assignee', 'priority', 'issuetype', 'updated', 'fixVersions'],
    nextPageToken: 'next-1',
  });
  assert.match(request.options.headers.Authorization, /^Basic /);
});

test('normalizeSiteUrl accepts HTTPS and strips query and fragment', () => {
  assert.equal(normalizeSiteUrl('https://example.atlassian.net/path/?x=1#hash'), 'https://example.atlassian.net/path');
});

test('normalizeSiteUrl rejects insecure or credential-bearing URLs', () => {
  assert.throws(() => normalizeSiteUrl('http://example.atlassian.net'), /HTTPS/);
  assert.throws(() => normalizeSiteUrl('https://user:pass@example.atlassian.net'), /credentials/);
});

test('ADF helpers preserve text and collect media IDs', () => {
  assert.deepEqual(textToAdf('First\n\nSecond'), {
    type: 'doc',
    version: 1,
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'First' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Second' }] },
    ],
  });
  const ids = collectMediaIds({ type: 'doc', content: [{ type: 'media', attrs: { id: 'media-1' } }] });
  assert.deepEqual([...ids], ['media-1']);
});
