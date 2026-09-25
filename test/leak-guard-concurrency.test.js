'use strict';
// The leak guard puts each of its runs in a concurrency group and cancels the
// older run whenever a newer one joins the same group. That is only safe when
// the newer run reads everything the older one would have; otherwise a scan
// simply never happens, and all that is left of it is a cancelled check.
//
// Opening a pull request fires `pull_request` (the commit messages) and
// `pull_request_target` (the title and body) at the same moment. While the
// group was named after the number alone, the later run cancelled the earlier,
// and most pull requests lost one of their two scans that way.
//
// These tests evaluate the real group expression from the workflow file against
// the context each trigger delivers, and check the rule from both sides: runs
// over the same text share a group, runs over different text never do.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKFLOW = path.join(__dirname, '..', '.github', 'workflows', 'leak-guard.yml');

// The top-level `concurrency:` block as key/value strings. Read from the file,
// never copied into this test, so a change to the key is a change under test.
function concurrencyBlock() {
  const lines = fs.readFileSync(WORKFLOW, 'utf8').split(/\r?\n/);
  const start = lines.indexOf('concurrency:');
  assert.ok(start >= 0, 'leak-guard.yml has no workflow-level concurrency block');
  const block = {};
  for (const line of lines.slice(start + 1)) {
    const m = line.match(/^\s+([\w-]+):\s*(.*?)\s*$/);
    if (!m) break;
    block[m[1]] = m[2];
  }
  return block;
}

// Just enough of the Actions expression language for this key: `github.*`
// paths joined by `||`, which yields the first truthy operand. Anything else
// fails here instead of being evaluated wrongly.
function evaluate(expression, github) {
  return expression.replace(/\$\{\{(.*?)\}\}/g, (_, inner) => {
    for (const operand of inner.split('||').map((s) => s.trim())) {
      assert.match(operand, /^github(\.\w+)+$/, `cannot evaluate \`${operand}\` here; extend evaluate()`);
      const value = operand
        .split('.')
        .slice(1)
        .reduce((obj, key) => (obj == null ? undefined : obj[key]), github);
      if (value) return String(value);
    }
    return '';
  });
}

const { group: KEY, 'cancel-in-progress': CANCEL } = concurrencyBlock();
const group = (github) => evaluate(KEY, github);

// The `github` context each trigger delivers, cut down to what a key could
// plausibly use. `ref` and `sha` follow what each event documents, so a key
// that leaned on either would meet the values it gets for real.
const MAIN = 'c0ffee0';
const on = {
  pullRequest: (number, action, head) => ({
    event_name: 'pull_request',
    ref: `refs/pull/${number}/merge`,
    sha: `merge-${number}-${head}`,
    event: { action, number, pull_request: { number, head: { sha: head } } }
  }),
  pullRequestTarget: (number, action, body) => ({
    event_name: 'pull_request_target',
    ref: 'refs/heads/main',
    sha: MAIN,
    event: { action, number, pull_request: { number, body } }
  }),
  issue: (number, action, body) => ({
    event_name: 'issues',
    ref: 'refs/heads/main',
    sha: MAIN,
    event: { action, issue: { number, body } }
  }),
  issueComment: (number, id, action = 'created') => ({
    event_name: 'issue_comment',
    ref: 'refs/heads/main',
    sha: MAIN,
    event: { action, issue: { number, pull_request: {} }, comment: { id } }
  }),
  reviewComment: (number, id, action = 'created') => ({
    event_name: 'pull_request_review_comment',
    ref: `refs/pull/${number}/merge`,
    sha: `merge-${number}`,
    event: { action, pull_request: { number }, comment: { id } }
  }),
  review: (number, id, action = 'submitted') => ({
    event_name: 'pull_request_review',
    ref: `refs/pull/${number}/merge`,
    sha: `merge-${number}`,
    event: { action, pull_request: { number }, review: { id } }
  }),
  push: (before, after) => ({
    event_name: 'push',
    ref: 'refs/heads/main',
    sha: after,
    event: { before, after }
  })
};

describe('leak-guard: which runs may cancel each other', () => {
  it('keeps the two scans of a newly opened pull request apart', () => {
    assert.notEqual(group(on.pullRequest(7, 'opened', 'aaa1')), group(on.pullRequestTarget(7, 'opened', 'body')));
  });

  it('never puts two triggers in one group, even where their numbers coincide', () => {
    // A comment id can equal a pull request number; then only the trigger
    // tells the two runs apart.
    const groups = [
      on.pullRequest(7, 'opened', 'aaa1'),
      on.pullRequestTarget(7, 'opened', 'body'),
      on.issue(7, 'opened', 'body'),
      on.issueComment(7, 7),
      on.reviewComment(7, 7),
      on.review(7, 7),
      on.push('aaa1', 'bbb2')
    ].map(group);
    assert.equal(new Set(groups).size, groups.length, groups.join('\n'));
  });

  it('still lets a newer run over the same text cancel the older one', () => {
    // Each of these re-reads the whole thing: the body as it is now, or all of
    // base..head, so the older run has nothing left to add.
    assert.equal(CANCEL, 'true');
    assert.equal(group(on.pullRequestTarget(7, 'opened', 'first')), group(on.pullRequestTarget(7, 'edited', 'second')));
    assert.equal(group(on.pullRequest(7, 'opened', 'aaa1')), group(on.pullRequest(7, 'synchronize', 'bbb2')));
    assert.equal(group(on.issue(8, 'opened', 'first')), group(on.issue(8, 'edited', 'second')));
    assert.equal(group(on.issueComment(7, 101)), group(on.issueComment(7, 101, 'edited')));
    assert.equal(group(on.review(7, 301)), group(on.review(7, 301, 'edited')));
  });

  it('gives every comment and every review a group of its own', () => {
    // A review with several inline comments fires one event per comment, all
    // in the same second, and each run reads only its own comment. A review's
    // own run reads only that review's summary.
    assert.notEqual(group(on.reviewComment(7, 201)), group(on.reviewComment(7, 202)));
    assert.notEqual(group(on.issueComment(7, 101)), group(on.issueComment(7, 102)));
    assert.notEqual(group(on.review(7, 301)), group(on.review(7, 302)));
  });

  it('gives every push to main a group of its own', () => {
    // A push run reads only its own before..after. Cancel it, and the next
    // push never reads those commits again.
    assert.notEqual(group(on.push('aaa1', 'bbb2')), group(on.push('bbb2', 'ccc3')));
  });
});
