# Contributing to Meistertracker

Thanks for your interest! Meistertracker is the operational backbone of [Meisterpilze](https://www.meisterpilze.de) and is in daily production use in our lab. The core scanning, tracking, label-printing, and CalDAV-sync workflows are stable. The camera-AI module under `mushroom_camera/` is in active development and not yet ready for production use.

This is a small, maintainer-paced project. Drive-by patches are welcome; please don't be offended if review takes a while.

## Reporting issues

- **Bugs and feature requests:** open a [GitHub issue](https://github.com/loewenmaehne/meistertracker/issues/new/choose). The forms ask for the bits we need (commit hash, Node version, repro steps).
- **Security vulnerabilities:** please file a private [Security Advisory](https://github.com/loewenmaehne/meistertracker/security/advisories/new) or email <security@meistertracker.de> — do **not** open a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

```sh
git clone https://github.com/loewenmaehne/meistertracker.git
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
4. Push your branch and open a Pull Request. The PR template will ask you to confirm tests, lint, and format are green, and that you license the change under AGPL-3.0-or-later.

## Code style

- **JavaScript:** ESLint (`eslint.config.js`) + Prettier (`.prettierrc`). Single quotes, semicolons, 2-space indent.
- **Python (camera module):** PEP 8, type hints where they help.
- **Commit messages:** short imperative subject (e.g. `fix(scan): drop trailing whitespace from barcode input`). Body optional but appreciated for the "why".

Don't reformat untouched files in the same PR as a logic change — it makes review harder.

## Tests

The test suite lives under `test/` and uses the Node.js built-in test runner. Add a test when you fix a bug or add a feature; aim for the smallest possible unit that exercises the change.

## Licensing

Meistertracker is licensed under **AGPL-3.0-or-later**. By submitting a contribution, you confirm that:

- You are the author of the contribution, **or** you have the right to submit it under this licence.
- You agree your contribution is licensed under AGPL-3.0-or-later.

There is no separate CLA. The PR template asks you to tick this box explicitly.

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

For open-ended questions that aren't bugs or feature requests, search [existing issues](https://github.com/loewenmaehne/meistertracker/issues?q=is%3Aissue) first; if nothing matches, file a new issue and we'll convert it to a discussion if useful.
