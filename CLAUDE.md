# CLAUDE.md

Instructions for Claude Code, and for anyone else writing in this repository.
This file covers one thing: not publishing what should stay private. For how to
build, test and contribute, see [CONTRIBUTING.md](CONTRIBUTING.md); for running
an instance, see [DEPLOYMENT.md](DEPLOYMENT.md).

## This repository is public

Not just the files. All of this is world-readable the moment it lands, and most
of it cannot be taken back:

| Surface | Taken back by |
| --- | --- |
| File contents | a rewrite of history, which does not touch anything below |
| Commit messages | a rewrite, and only before the branch is pushed |
| Branch names | deleting the branch, though `refs/pull/*` keeps a copy |
| Pull request titles and bodies | editing, **plus** deleting the old revision by hand |
| Issue and review comments | the same two steps |
| Workflow logs | nothing; assume permanent |

The row that surprises people is the pull request one. Editing a description
does not remove the old text — GitHub keeps an edit history and shows it to
anyone who can see the page. Someone has to open the "edited" dropdown above the
description and delete the earlier revision as a separate act.

## Never write the address of a live instance

Not in a file, not in a commit message, not in a branch name, not in a pull
request title, body or comment. This is the rule that has actually been broken
here, and it was broken by careful work rather than sloppy work: writing down
what you tested against is good practice, and

    - [ ] Server: https://<the real host>:3000/caldav/

is an honest verification note and a published address in the same line.

**Use the placeholders this repository already documents instead:**

| Instead of | Write |
| --- | --- |
| the real DuckDNS host | `<your-name>.duckdns.org` |
| the machine's IP | `<server-ip>` |
| the LAN address of a PC | `<windows-pc-ip>` |
| any other domain | `<your-domain>`, or `example.com` |
| a token, key or password | `<your-token>`, or leave the value out |

The same goes for anything else that identifies one particular installation:
routable IP addresses, tunnel URLs (`ngrok`, `trycloudflare`, `tailscale`),
DuckDNS tokens, app passwords, API keys. The bare service host is fine —
`www.duckdns.org` is where the app sends its updates, and saying so leaks
nothing. A label in front of it is what identifies a machine.

### How to write a verification note without an address

Say what you checked, not where. These carry the same information and none of
the exposure:

- `- [ ] Server: https://<your-name>.duckdns.org:3000/caldav/`
- "Checked against the production instance over the public hostname"
- "Reachable from outside the LAN; certificate valid; session cookie survives"

If a reader needs the real address to reproduce something, they either already
have it or should be given it out of band.

## The guard

`scripts/leak-scan.js` holds the rules. It runs in four places:

- **`commit-msg` hook** — the message being written
- **`pre-push` hook** — every outgoing commit message, and the branch name
- **CI** (`.github/workflows/leak-guard.yml`) — tracked files and the commit
  messages in the range; `npm test` covers the tree as well
- **The pull request workflow** — titles, bodies and comments, which it
  **redacts automatically** and then comments to explain

Only the hooks run before anything is public, and hooks are not cloned. Enable
them once per clone:

```
git config core.hooksPath .githooks
```

The rules are patterns, not a list of real names, and findings report a location
rather than the text that matched. Both are deliberate: a denylist naming the
real host would publish it, and workflow logs are public, so a guard that echoed
its match would leak on exactly the runs where it fired. Keep it that way when
you extend it — and never add a real hostname to the tests.

**When the guard fires, fix the text.** Do not reach for `--no-verify`. If a hit
is genuinely wrong, put `leak-scan:allow` on that line, in the same commit, so
the exception is reviewable.

## If something got out anyway

In order, and the first step is the one that matters:

1. **Rotate it.** Editing text does not un-publish it. A hostname that has been
   public is public: register a new DuckDNS subdomain, reissue the certificate,
   retire the old name. A token that has been public is burned; issue a new one.
   Everything below only makes the exposure smaller.
2. **Redact the text.** The workflow does this for pull request prose on its
   own. For a commit message it means rewriting history, which only works before
   the push.
3. **Delete the old revision** from the edit history by hand, as described
   above. Skipping this leaves the original one click away.
4. **Note that `refs/pull/*` outlives the branch.** GitHub keeps pull request
   refs after a branch is deleted, and only GitHub Support can purge them.
