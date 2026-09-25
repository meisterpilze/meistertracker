'use strict';
// The prose half of the leak guard, run against a stand-in for the GitHub API.
//
// It redacts titles, bodies, comments and reviews in place, on a public
// repository, from a workflow that may go months without firing on a real leak.
// So the first real run must not also be the first test: these tests hand it the
// payload of each trigger and check which endpoint it writes to, with what, and
// that nothing it logs or writes carries the address it found.
//
// The workflow half is checked at the bottom: every trigger reaches exactly one
// job, and every trigger the prose job is handed has an entry here.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { guardProse, SURFACES } = require('../scripts/leak-guard-prose.js');
const { redact } = require('../scripts/leak-scan.js');

// An invented host, as everywhere in these tests. It has to be leak-shaped or
// there is nothing to redact; the marker keeps the tree scan off this one line.
const LEAK = 'Checked on https://acme-intra.duckdns.org:3000/caldav/ and it syncs.'; // leak-scan:allow
const REDACTED = redact(LEAK, { surface: 'prose' });

const REPO = { owner: 'meisterpilze', repo: 'meistertracker' };
const USER = { login: 'someone', type: 'User' };

// The payload each trigger delivers, cut down to what the guard reads.
const PAYLOADS = {
  pull_request_target: (text) => ({ pull_request: { number: 7, title: 'A title', body: text } }),
  issues: (text) => ({ issue: { number: 8, title: 'A title', body: text } }),
  issue_comment: (text) => ({ issue: { number: 7 }, comment: { id: 101, body: text, user: USER } }),
  pull_request_review_comment: (text) => ({
    pull_request: { number: 7 },
    comment: { id: 201, body: text, user: USER }
  }),
  pull_request_review: (text) => ({ pull_request: { number: 7 }, review: { id: 301, body: text, user: USER } })
};

// Runs the guard against a recording stand-in for `github.rest`. `refuse`
// names an endpoint that answers the way a read-only token does.
async function run(eventName, payload, { refuse } = {}) {
  const calls = [];
  const log = [];
  const endpoint = (name) => async (args) => {
    calls.push({ name, args });
    if (name === refuse) throw new Error('Resource not accessible by integration');
    return { data: {} };
  };
  const github = {
    rest: {
      pulls: {
        update: endpoint('pulls.update'),
        updateReview: endpoint('pulls.updateReview'),
        updateReviewComment: endpoint('pulls.updateReviewComment')
      },
      issues: {
        update: endpoint('issues.update'),
        updateComment: endpoint('issues.updateComment'),
        createComment: endpoint('issues.createComment')
      }
    }
  };
  const core = {
    info: (m) => log.push(m),
    warning: (m) => log.push(m),
    setFailed: (m) => log.push('FAILED: ' + m)
  };
  await guardProse({ github, context: { eventName, payload, repo: REPO }, core });
  return { calls, log };
}

describe('leak-guard prose: a review', () => {
  it('redacts the review in place and says so on the pull request', async () => {
    const { calls, log } = await run('pull_request_review', PAYLOADS.pull_request_review(LEAK));
    assert.deepEqual(
      calls.map((c) => c.name),
      ['pulls.updateReview', 'issues.createComment']
    );
    assert.deepEqual(calls[0].args, { ...REPO, pull_number: 7, review_id: 301, body: REDACTED });
    assert.equal(calls[1].args.issue_number, 7);
    assert.ok(log.includes('leak-guard: redacting 1 finding(s) in this review'), log.join('\n'));
  });

  it('leaves a clean review alone, and one with no text at all', async () => {
    // Approving without a word delivers a null body.
    for (const body of ['Looks good to me.', '', null]) {
      const { calls, log } = await run('pull_request_review', PAYLOADS.pull_request_review(body));
      assert.deepEqual(calls, [], String(body));
      assert.deepEqual(log, ['leak-guard: clean'], String(body));
    }
  });

  it('leaves a review by a bot alone, as it does a bot comment', async () => {
    const payload = PAYLOADS.pull_request_review(LEAK);
    payload.review.user = { login: 'some-app[bot]', type: 'Bot' };
    assert.deepEqual(await run('pull_request_review', payload), { calls: [], log: [] });
  });

  it('fails when the token may not write, and claims no redaction', async () => {
    // A review on a pull request from a fork runs with a read-only token.
    const { calls, log } = await run('pull_request_review', PAYLOADS.pull_request_review(LEAK), {
      refuse: 'pulls.updateReview'
    });
    assert.deepEqual(
      calls.map((c) => c.name),
      ['pulls.updateReview']
    );
    assert.match(log.at(-1), /^FAILED: leak-guard found something and could not redact it\. Edit it by hand, now: /);
  });
});

describe('leak-guard prose: every surface', () => {
  it('writes each surface back through its own endpoint, then comments on its thread', async () => {
    const expected = {
      pull_request_target: ['pulls.update', { pull_number: 7, title: 'A title', body: REDACTED }, 7],
      issues: ['issues.update', { issue_number: 8, title: 'A title', body: REDACTED }, 8],
      issue_comment: ['issues.updateComment', { comment_id: 101, body: REDACTED }, 7],
      pull_request_review_comment: ['pulls.updateReviewComment', { comment_id: 201, body: REDACTED }, 7],
      pull_request_review: ['pulls.updateReview', { pull_number: 7, review_id: 301, body: REDACTED }, 7]
    };
    assert.deepEqual(Object.keys(expected).sort(), Object.keys(SURFACES).sort());
    for (const [event, [endpoint, args, thread]] of Object.entries(expected)) {
      const { calls } = await run(event, PAYLOADS[event](LEAK));
      assert.deepEqual(
        calls.map((c) => c.name),
        [endpoint, 'issues.createComment'],
        event
      );
      assert.deepEqual(calls[0].args, { ...REPO, ...args }, event);
      assert.equal(calls[1].args.issue_number, thread, event);
    }
  });

  it('never writes the address into the log or into what it posts', async () => {
    // The log of a public repository's workflow is public, so the finding may
    // say where the address was, and never what it was.
    for (const event of Object.keys(SURFACES)) {
      const out = JSON.stringify(await run(event, PAYLOADS[event](LEAK)));
      assert.ok(!out.includes('acme-intra'), event);
    }
  });

  it('refuses an event it has no entry for, rather than guess', async () => {
    const { calls, log } = await run('discussion_comment', { comment: { body: LEAK, user: USER } });
    assert.deepEqual(calls, []);
    assert.match(log[0], /^FAILED: leak-guard cannot read a discussion_comment event/);
  });
});

describe('leak-guard workflow: triggers and the prose job', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'leak-guard.yml'), 'utf8');

  // The keys of the `on:` block. It ends at the next line that starts in the
  // first column, which the indented comments inside it never do.
  const triggers = [
    ...yml
      .split(/^on:\r?\n/m)[1]
      .split(/^\S/m)[0]
      .matchAll(/^ {2}([a-z_]+):/gm)
  ].map((m) => m[1]);

  // Each job's text, keyed by job name, and the events its `if:` accepts.
  const jobs = {};
  for (const part of yml.split(/^jobs:\r?\n/m)[1].split(/^(?= {2}[a-z_-]+:\r?$)/m)) {
    const name = part.match(/^ {2}([a-z_-]+):/);
    if (name) jobs[name[1]] = part;
  }
  const accepts = (job) =>
    [...jobs[job].split(/^\s+runs-on:/m)[0].matchAll(/github\.event_name == '([a-z_]+)'/g)].map((m) => m[1]);

  it('hands every trigger to exactly one job', () => {
    // A trigger no job accepts runs, reads nothing, and passes.
    const accepted = Object.keys(jobs).flatMap(accepts);
    assert.deepEqual([...accepted].sort(), [...triggers].sort());
  });

  it('has an entry for every trigger the prose job is handed', () => {
    assert.deepEqual(accepts('prose').sort(), Object.keys(SURFACES).sort());
  });

  it("runs main's copy of this module on every trigger", () => {
    // Without the ref, the review triggers check out the pull request's merge
    // commit, and the code deciding what to redact would be the contributor's.
    assert.ok(jobs.prose.includes('ref: ${{ github.event.repository.default_branch }}'));
    assert.ok(jobs.prose.includes('/scripts/leak-guard-prose.js'));
  });
});
