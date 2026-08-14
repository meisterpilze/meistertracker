# Contributing to Meistertracker

Thanks for your interest! Meistertracker is the operational backbone of [Meisterpilze](https://www.meisterpilze.de) and is in daily production use in our lab. The core scanning, tracking, label-printing, and CalDAV-sync workflows are stable. The camera-AI module under `mushroom_camera/` is in active development and not yet ready for production use.

This is a small, maintainer-paced project. Drive-by patches are welcome; please don't be offended if review takes a while.

## Reporting issues

- **Bugs and feature requests:** open a [GitHub issue](https://github.com/meisterpilze/meistertracker/issues/new/choose). The forms ask for the bits we need (commit hash, Node version, repro steps).
- **Security vulnerabilities:** please file a private [Security Advisory](https://github.com/meisterpilze/meistertracker/security/advisories/new) or email <security@meistertracker.com> — do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

```sh
git clone https://github.com/meisterpilze/meistertracker.git
cd meistertracker
npm ci
npm test
```

You'll need **Node.js 22 or newer**. The test suite is self-contained — no real database or network needed.

To run the server locally, use the watchdog wrapper:

```sh
./update_server.sh
```

This is the only supported way to start the server (see in-repo notes — it handles certificate generation, port binding, and the watchdog process).

## Making changes

1. Fork the repo and create a topic branch off `main`:
   ```sh
   git checkout -b fix/short-description
   ```
2. Make the change. Keep commits small and focused — one logical change per commit.
3. Before pushing, run the local checks:
   ```sh
   npm test
   npm run lint
   npm run format:check
   ```
   `npm run lint:fix` and `npm run format` will auto-fix most issues.
4. Sign off each commit (`git commit -s`) — see [Sign your work](#sign-your-work) below.
5. Push your branch and open a Pull Request. The PR template will ask you to confirm tests, lint, and format are green, and that you license the change under AGPL-3.0-or-later.

## Code style

- **JavaScript:** ESLint (`eslint.config.js`) + Prettier (`.prettierrc`). Single quotes, semicolons, 2-space indent.
- **Python (camera module):** PEP 8, type hints where they help.
- **Commit messages:** English, short imperative subject (e.g. `fix(scan): drop trailing whitespace from barcode input`). Body optional but appreciated for the "why". German domain terms (Charge, Sorte, Freigabe) are fine inside an English subject — they are what the UI calls those things.
- **PR titles:** English as well. A squash merge takes its subject from the PR title whenever the branch holds more than one commit, so the title ends up in the permanent history.

Don't reformat untouched files in the same PR as a logic change — it makes review harder.

## Tests

The test suite lives under `test/` and uses the Node.js built-in test runner. Add a test when you fix a bug or add a feature; aim for the smallest possible unit that exercises the change.

## Licensing

Meistertracker is licensed under **AGPL-3.0-or-later**. By submitting a contribution, you confirm that:

- You are the author of the contribution, **or** you have the right to submit it under this licence.
- You agree your contribution is licensed under AGPL-3.0-or-later.

There is no CLA and no copyright assignment. You keep the copyright in what you wrote; we
only need it on record that you had the right to send it. That record is the sign-off below.

## Sign your work

Every commit needs a `Signed-off-by` line. It is the
[Developer Certificate of Origin 1.1](https://developercertificate.org/) — the same
one-paragraph statement the Linux kernel uses. Signing off says: this contribution is mine
to give, or I have the right to pass it on under AGPL-3.0-or-later, and I understand that
it and my sign-off are public and kept forever.

Git writes the line for you when you pass `-s`:

```sh
git commit -s -m "fix(scan): drop trailing whitespace from barcode input"
```

which appends

```
Signed-off-by: Jane Doe <jane@example.com>
```

Use your real name and an address that reaches you — pseudonyms don't work, because the
point of the line is that someone can be asked. The name comes from your Git config:

```sh
git config --global user.name "Jane Doe"
git config --global user.email "jane@example.com"
```

Forgot on the last commit? `git commit --amend -s --no-edit`. On several? Sign them all
with `git rebase --signoff origin/main`, then force-push your branch.

No signature, no GPG key, no account anywhere — just the line.

## What's currently maintained

| Area | Status |
| --- | --- |
| Scanning, batches, cultures, harvests | Production |
| Label printing (Zebra, browser preview) | Production |
| CalDAV calendar sync | Production |
| MCP server | Production |
| PWA / offline | Production |
| Camera AI (`mushroom_camera/`) | Active development — not production ready |
| Tests, CI, lint | Production |

If you want to work on the camera module, please open an issue first to talk about scope — it's moving fast and may overlap with in-flight changes.

## Questions

For open-ended questions that aren't bugs or feature requests, search [existing issues](https://github.com/meisterpilze/meistertracker/issues?q=is%3Aissue) first; if nothing matches, file a new issue and we'll convert it to a discussion if useful.
