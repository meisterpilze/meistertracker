'use strict';
// Einen Ordner oder eine Datei unlesbar oder schreibgeschützt machen, und einen
// Link auf einen Ordner legen, auf Linux und auf Windows gleich.
//
// Die Tests dafür waren für die CI auf Linux geschrieben. Auf Windows, wo die
// App läuft, setzt chmod nur das Schreibschutz-Attribut: ein Ordner mit 0o000
// bleibt lesbar, und der Test prüft nichts. Dort sperrt eine Verweigerung im
// ACL für den eigenen Benutzer, und Node meldet dann EPERM, wie bei einem
// Stick, dessen Rechte nicht passen. Ein symbolischer Link braucht auf Windows
// Adminrechte oder den Entwicklermodus; ein Junction nicht, und genau den legt
// ein NTFS-Stick an.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('node:child_process');

const WIN = process.platform === 'win32';
// Mit vollem Pfad: aus Git Bash gestartet steht sonst dessen Werkzeugkasten
// vorne im PATH.
const ICACLS = WIN ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe') : null;
const WER = WIN ? (process.env.USERDOMAIN ? process.env.USERDOMAIN + '\\' : '') + process.env.USERNAME : null;

function icacls(p, ...args) {
  execFileSync(ICACLS, [p, ...args], { stdio: 'ignore', windowsHide: true });
}

function istOrdner(p) {
  return fs.statSync(p).isDirectory();
}

// Weder lesen noch, bei einem Ordner, auflisten.
function sperreLesen(p) {
  if (WIN) icacls(p, '/deny', WER + (istOrdner(p) ? ':(OI)(CI)(R)' : ':(R)'));
  else fs.chmodSync(p, 0o000);
}

// Lesen ja, schreiben nein: ein schreibgeschützter Stick.
function sperreSchreiben(p) {
  if (WIN) icacls(p, '/deny', WER + (istOrdner(p) ? ':(OI)(CI)(W)' : ':(W)'));
  else fs.chmodSync(p, 0o500);
}

// Hebt beides wieder auf.
function freigeben(p) {
  if (WIN) icacls(p, '/remove:d', WER);
  else fs.chmodSync(p, istOrdner(p) ? 0o700 : 0o600);
}

// Ein Link auf einen Ordner, an der Stelle `wo`.
function ordnerLink(ziel, wo) {
  fs.symlinkSync(ziel, wo, WIN ? 'junction' : 'dir');
}

module.exports = { sperreLesen, sperreSchreiben, freigeben, ordnerLink };
