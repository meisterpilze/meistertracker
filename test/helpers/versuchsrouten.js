'use strict';
// Die Versuchs-Routen aus server.js, gegen eine echte Datenbank.
//
// Der Abschnitt reicht von "Versuche und ihre Ansaetze" bis vor
// "Vorhaben-Texte". Wie er herausgeschnitten wird und laeuft, steht in
// routen.js; hier steht, was er aus server.js braucht.
const { routen, jpeg } = require('./routen');

const ABSCHNITT = {
  name: 'versuchsrouten',
  von: '// ── Versuche und ihre Ansaetze',
  bis: '// ── Vorhaben-Texte',
  helfer: [
    'jsonOk',
    'jsonErr',
    'requireAdmin',
    'safeErr',
    'validateRequired',
    'validateTypes',
    'validateLengths',
    'validateDate',
    'validateDay',
    'versuchPruefen',
    '_ensurePhotoDirSize',
    '_parseImageDataUrl',
    '_isJpegMagic',
    'savePhotoToDisk',
    '_discardPhotoFiles',
    'ansatzPruefen',
    'etagMatches'
  ],
  konstanten: ['PHOTO_MAX_BYTES', 'PHOTO_THUMB_MAX_BYTES', 'PHOTO_SIZE_REFRESH_MS', 'EXP_MAX_PHOTOS_PER_CALL'],
  literale: ['ANSATZ_TYPEN'],
  // Die Versuchs-Routen vergleichen url, den Pfad ohne Query.
  liestUrl: true
};

// opts: deckel und benutzer, siehe routen() in routen.js.
function versuchsrouten(opts) {
  return routen(ABSCHNITT, opts);
}

module.exports = { versuchsrouten, jpeg };
