'use strict';
// Die Kontaminations-Routen aus server.js, gegen eine echte Datenbank.
//
// Der Abschnitt reicht von "Contamination reports" bis vor "Harvests". Wie er
// herausgeschnitten wird und laeuft, steht in routen.js; hier steht, was er aus
// server.js braucht.
const { routen, jpeg } = require('./routen');

const ABSCHNITT = {
  name: 'kontaminationsrouten',
  von: '// -- Contamination reports --',
  bis: '// -- Harvests --',
  helfer: [
    'jsonOk',
    'jsonErr',
    'safeErr',
    'validateRequired',
    'validateTypes',
    'validateEnum',
    'validateLengths',
    'contamReportTargets',
    '_ensurePhotoDirSize',
    '_parseImageDataUrl',
    '_isJpegMagic',
    'savePhotoToDisk',
    '_discardPhotoFiles',
    'etagMatches'
  ],
  konstanten: ['PHOTO_MAX_BYTES', 'PHOTO_THUMB_MAX_BYTES', 'PHOTO_SIZE_REFRESH_MS', 'CONTAM_MAX_TARGETS'],
  // Der Abschnitt liest nur req.url.
  liestUrl: false
};

// opts: deckel und benutzer, siehe routen() in routen.js.
function kontaminationsrouten(opts) {
  return routen(ABSCHNITT, opts);
}

module.exports = { kontaminationsrouten, jpeg };
