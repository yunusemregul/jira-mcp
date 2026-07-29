import assert from 'node:assert/strict';
import test from 'node:test';
import { convertToMarkdown, converterCandidates } from '../tools/attachment_to_markdown.js';

function withCmd(t, value) {
  const original = process.env.JIRA_MARKITDOWN_CMD;
  process.env.JIRA_MARKITDOWN_CMD = value;
  t.after(() => {
    if (original === undefined) delete process.env.JIRA_MARKITDOWN_CMD;
    else process.env.JIRA_MARKITDOWN_CMD = original;
  });
}

test('converterCandidates falls back to uvx unless overridden', t => {
  const original = process.env.JIRA_MARKITDOWN_CMD;
  delete process.env.JIRA_MARKITDOWN_CMD;
  t.after(() => {
    if (original !== undefined) process.env.JIRA_MARKITDOWN_CMD = original;
  });

  assert.deepEqual(converterCandidates(), [['markitdown'], ['uvx', 'markitdown']]);

  process.env.JIRA_MARKITDOWN_CMD = '  uvx   markitdown  ';
  assert.deepEqual(converterCandidates(), [['uvx', 'markitdown']]);
});

test('a missing converter reports every command tried plus install instructions', async t => {
  withCmd(t, '/nonexistent/markitdown-does-not-exist');

  await assert.rejects(convertToMarkdown('/tmp/whatever.xlsx'), err => {
    assert.match(err.message, /markitdown is not available/);
    assert.match(err.message, /"\/nonexistent\/markitdown-does-not-exist" \(ENOENT\)/);
    assert.match(err.message, /pip install "markitdown\[all\]"/);
    assert.match(err.message, /JIRA_MARKITDOWN_CMD/);
    assert.match(err.message, /every other tool works without it/);
    return true;
  });
});

test('a converter that runs and fails surfaces its stderr, not an install hint', async t => {
  // "false" exists on PATH but exits non-zero, standing in for a broken markitdown.
  withCmd(t, 'node -e process.stderr.write("boom");process.exit(1); --');

  await assert.rejects(convertToMarkdown('/tmp/whatever.xlsx'), err => {
    assert.match(err.message, /failed to convert this attachment/);
    assert.match(err.message, /boom/);
    assert.doesNotMatch(err.message, /is not available/);
    return true;
  });
});
