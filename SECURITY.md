# Security Policy

## Reporting a vulnerability

Please report security issues **privately** through one of these channels:

- **GitHub Security Advisory** (preferred):
  <https://github.com/meisterpilze/meistertracker/security/advisories/new>
  Gives us a private workspace to coordinate the fix and credits you on disclosure.
- **Email**: <security@meistertracker.com>
  Use this if you don't have a GitHub account or the advisory form is unavailable. Please prefix the subject line with `[security]`. We will reply from the maintainer's regular address.

We aim to acknowledge reports within **72 hours**. For HIGH-severity issues we aim to ship a fix within **30 days**; lower-severity issues may take longer depending on the scope of the change required.

Please do **not** open public GitHub issues for security vulnerabilities — that exposes the bug to anyone watching the repo before a fix is available.

> When you contact us by email, we process your message to handle your report. See the [privacy notice for meistertracker.com](https://meistertracker.com/legal) for how that data is handled.

## Disclosure

We follow coordinated disclosure: reporter and maintainer agree on a public-disclosure date once a fix is available. We credit reporters in the fixing commit and in the published advisory unless you prefer to stay anonymous.

## Supported versions

The latest commit on `main` is the only supported version. There are no long-lived release branches; deploy via `update_server.sh` (or fast-forward your clone to `origin/main`) to pick up the latest fix.

## Out of scope

- Issues against unmodified third-party dependencies — please report those upstream
- Issues that require physical access to the running server or its database file
- Self-XSS that requires the victim to paste attacker-supplied content into their own session
- Reports based purely on missing security headers without a concrete exploit path
