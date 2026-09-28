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

Whether GitHub shows the repository as public or private right now does not
matter. Treat everything above as readable by anyone in the world, at any
time, and when something gets in anyway, clean it up completely, as described
at the end of this file, whatever the visibility is.

## Never write the address of a live instance

Not in a file, not in a commit message, not in a branch name, not in a pull
request title, body or comment. This rule is easy to break with careful work,
not only with sloppy work: writing down
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

## Keep the business out of the code

The tracker runs a real lab, and what that lab knows is not part of the code:
research notes, product and build plans, recipes, prices, customer data,
business figures, strategy. None of it goes into a file, a commit message, a
branch name, or a pull request title, body or comment. That includes text an
assistant writes on someone's behalf, and it is the case most likely to slip:
asked to "put this into the app", the quickest route is a constant in `app.js`.

- **Content the app shows lives in the database** and comes in through the app.
  The Vorhaben tabs take their documents through the import on that page
  (`/api/project-docs`); notes and experiments through their own pages. The code
  knows the shape, never the wording.
- **Tests and examples use made-up content.**
- **A pull request describes the code**, not what the content says.

Unlike an address, content cannot be rotated. Once it has been public it stays
known, which is why it has to stay out in the first place.

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

In order, and the first step is the one that matters. All of them are done,
whether the repository is public or private at the time:

1. **Rotate it.** Editing text does not un-publish it. A hostname that has been
   public is public: register a new DuckDNS subdomain, reissue the certificate,
   retire the old name. A token that has been public is burned; issue a new one.
   Content has nothing to rotate, which is why it has to stay out in the first
   place. Everything below only makes the exposure smaller, and is still done.
2. **Redact the text.** The workflow does this for pull request prose on its
   own; anything it missed is edited by hand.
3. **Rewrite the history** for file contents and commit messages, pushed or
   not. Agree on a date first: afterwards every clone is replaced, including
   the one on the server that runs the app, or the next push from an old clone
   brings the commits back.
4. **Delete the old revision** from the edit history by hand, as described
   above. Skipping this leaves the original one click away.
5. **Ask GitHub Support to purge `refs/pull/*` and cached views.** GitHub keeps
   pull request refs after a branch is deleted and after a rewrite, and only
   Support can remove them.
