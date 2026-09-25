'use strict';
// The prose half of the leak guard: read the title, body, comment or review
// that fired the workflow, and redact it in place if it carries an address.
// .github/workflows/leak-guard.yml calls this through actions/github-script,
// which hands over its `github`, `context` and `core`.
//
// It is a file rather than the workflow's inline script for two reasons. The
// workflow checks out main before calling it, so even on the review triggers —
// which run a pull request's own copy of the workflow — the code that decides
// what gets redacted is main's. And a file can be tested. The inline script
// never was, and the review path may go months between real runs; the first
// one should not also be its first test.

const guard = require('./leak-scan.js');

const OPTS = { surface: 'prose' };

// Every surface the workflow listens to: what the log calls it, the text it
// carries, and how the redacted text goes back. One entry each, so a surface
// cannot be read without also being written — two parallel switches could
// drift, and the explanatory comment would then claim a redaction that never
// happened.
const SURFACES = {
  pull_request_target: {
    kind: 'pull request',
    read: (p) => ({ title: p.pull_request.title, body: p.pull_request.body }),
    write: (rest, repo, p, { title, body }) =>
      rest.pulls.update({ ...repo, pull_number: p.pull_request.number, title, body })
  },
  issues: {
    kind: 'issue',
    read: (p) => ({ title: p.issue.title, body: p.issue.body }),
    write: (rest, repo, p, { title, body }) =>
      rest.issues.update({ ...repo, issue_number: p.issue.number, title, body })
  },
  issue_comment: {
    kind: 'comment',
    read: (p) => ({ body: p.comment.body }),
    write: (rest, repo, p, { body }) => rest.issues.updateComment({ ...repo, comment_id: p.comment.id, body })
  },
  pull_request_review_comment: {
    kind: 'comment',
    read: (p) => ({ body: p.comment.body }),
    write: (rest, repo, p, { body }) => rest.pulls.updateReviewComment({ ...repo, comment_id: p.comment.id, body })
  },
  // The summary a reviewer writes above the inline comments. Those arrive as
  // `pull_request_review_comment`, one event each; this is the rest.
  pull_request_review: {
    kind: 'review',
    read: (p) => ({ body: p.review.body }),
    write: (rest, repo, p, { body }) =>
      rest.pulls.updateReview({ ...repo, pull_number: p.pull_request.number, review_id: p.review.id, body })
  }
};

async function guardProse({ github, context, core }) {
  const surface = SURFACES[context.eventName];
  if (!surface) {
    core.setFailed(`leak-guard cannot read a ${context.eventName} event; add it to SURFACES`);
    return;
  }
  const p = context.payload;

  // Never chase our own tail: the redaction below edits text, which fires
  // `edited` again, and our explanatory comment is a comment.
  const author = (p.comment || p.review || {}).user;
  if (author && author.type === 'Bot') return;

  const text = surface.read(p);
  const title = text.title || '';
  const body = text.body || '';
  const kind = surface.kind;

  const findings = [
    ...guard.scan(title, { ...OPTS, label: `${kind} title` }),
    ...guard.scan(body, { ...OPTS, label: `${kind} body` })
  ];
  if (findings.length === 0) {
    core.info('leak-guard: clean');
    return;
  }

  // Locations only. This log is public on a public repository, so printing the
  // match here would leak on the very runs that fire.
  core.warning(`leak-guard: redacting ${findings.length} finding(s) in this ${kind}`);
  core.info(guard.formatFindings(findings));

  const repo = { owner: context.repo.owner, repo: context.repo.repo };
  try {
    await surface.write(github.rest, repo, p, { title: guard.redact(title, OPTS), body: guard.redact(body, OPTS) });
  } catch (err) {
    core.setFailed('leak-guard found something and could not redact it. Edit it by hand, now: ' + err.message);
    return;
  }

  const number = (p.pull_request || p.issue || {}).number;
  if (!number) return;
  await github.rest.issues.createComment({
    ...repo,
    issue_number: number,
    body: [
      '**leak-guard redacted this automatically.**',
      '',
      `It carried something that must not be public — see the run log for the`,
      `location (never the value). The text has been replaced with a placeholder.`,
      '',
      '**This is not the end of it.** GitHub keeps an edit history and shows it to',
      'anyone who can see this page, so the original is still one click away. A',
      'maintainer needs to open the "edited" dropdown and delete the earlier',
      'revision. If what leaked was an address, treat it as public from now on and',
      'rotate it.',
      '',
      'The rules and the placeholders to use instead are in `CLAUDE.md`.'
    ].join('\n')
  });
}

module.exports = { guardProse, SURFACES };
