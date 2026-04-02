MEISTERPILZE LAB TRACKER — Setup Guide
=======================================

WHAT'S IN THIS FOLDER
----------------------
  index.html          — The app itself
  server.js           — Local web server (Node.js)
  START_SERVER.bat    — Start the server (double-click)
  SETUP_AUTOSTART.bat — Make server start with Windows automatically
  README.txt          — This file


STEP 1 — INSTALL NODE.JS (one time only)
-----------------------------------------
1. Go to https://nodejs.org
2. Download the LTS version (left button)
3. Install it — all defaults are fine
4. Restart your PC after installing


STEP 2 — START THE SERVER
---------------------------
1. Double-click START_SERVER.bat
2. A black window appears showing two addresses, like:
     Open on this PC:      http://localhost:3000
     Open on phone/tablet: http://192.168.1.50:3000
3. Open Chrome/Firefox on your PC and go to http://localhost:3000
4. On your phone/tablet, connect to the same WiFi and open the tablet address

Keep the black window open while you're scanning.
You can minimise it — just don't close it.


STEP 3 — AUTOSTART (optional but recommended)
-----------------------------------------------
To make the server start automatically every time Windows boots:
1. Double-click SETUP_AUTOSTART.bat
2. Done — next time Windows starts, the server runs in the background automatically


STEP 4 — LABEL PRINTING WITH GK420D
--------------------------------------
The app uses "Zebra Browser Print" to send labels directly to your GK420d.

Install Zebra Browser Print (one time only):
1. Go to: https://www.zebra.com/us/en/support-downloads/printer-software/browser-print.html
2. Download "Zebra Browser Print" for Windows
3. Install it
4. It runs in the background (look for the Zebra icon in the system tray near the clock)
5. Make sure your GK420d is connected via USB and turned on
6. Open the app → go to "Print labels" → it will show "Connected: GK420d" in green

To print labels:
1. Create a batch in "New batch"
2. Go to "Print labels"
3. Select the batch
4. Choose label content
5. Click "Print to GK420d"

Labels are 60×30mm, Code 128 barcode, optimised for the GK420d at 203dpi.

If Zebra Browser Print is not available, you can also click "Download ZPL file"
and send it to the printer manually.


DAY-TO-DAY WORKFLOW
--------------------
1. Open http://localhost:3000 in browser (or bookmark it)
2. Go to "Scan" tab
3. Click the scan field so it's active (blue border)
4. Scan ADD barcode → scan location (INC/TENT1/etc) → scan bag barcode
5. For moving: scan MOVE → scan FROM location → scan TO location → scan bag
6. For removing: scan REMOVE → scan bag
7. Check "Live status" to see all batches at a glance

Print the "Reference barcodes" page and keep it at your scanning station
so you always have ADD/MOVE/REMOVE/INC/TENT1/etc barcodes ready to scan.


TROUBLESHOOTING
----------------
Scanner not responding:
  - Click the scan input field first to make sure it has focus
  - The scanner must be set to USB Keyboard mode (see scanner manual)
  - Set Country Mode to Germany (see scanner manual, page 57)

Zebra Browser Print not connecting:
  - Make sure the Zebra Browser Print app is running (check system tray)
  - Make sure GK420d is on and USB cable is plugged in
  - Try "Retry connection" button in the Print labels tab

Server not starting:
  - Make sure Node.js is installed (go to https://nodejs.org)
  - Try running START_SERVER.bat as Administrator (right-click → Run as administrator)

App data:
  - All data is saved in your browser's localStorage
  - Data stays between sessions automatically
  - If you clear browser data/cache, you will lose your batches and scan log
  - For a permanent backup, use the browser's export feature (coming soon)
