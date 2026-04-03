---
name: Never change port or launch config
description: The server always runs on port 3000, started via START.bat — never switch ports or modify launch.json
type: feedback
---

Never change the server port from 3000. The user starts the server via START.bat which handles updates (git pull) and startup.

**Why:** The production server is always running on port 3000. Changing the port breaks the workflow.

**How to apply:** If port 3000 is occupied, that IS the running server. Don't try to start a second instance or change the port. To test changes, the user will restart via START.bat.
