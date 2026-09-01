// A throwaway database with enough in it that every table has rows.
//
// This is the half of scripts/measure-mobile.js --app that decides what the
// measurement is worth. An empty app renders "nothing here yet" on every page,
// and a stand that measures those screens reports that the layout holds. It
// held because there was nothing in it.
//
// 3. **Every name and address is invented.** This repository is public, and a
//    real name beside a real street says where a particular person stands on a
//    particular weekday — that is not a measurement, it is a fact about
//    somebody. The stand needs values that are LONG, not values that are true.
//    A fixture carrying both went in and every rule in leak-scan passed it: an
//    address is not a host, not an IP and not a token, so nothing looked. There
//    is a rule for it now.
//
// Two rules shape the fixture, and both are about width:
//
// 1. **The values are long on purpose.** A column is not too narrow for
//    "Shiitake"; it is too narrow for "Igelstachelbart (Lion's Mane) HER-2201".
//    The names, notes and locations below are the longest plausible ones, not
//    the shortest, because the shortest ones prove nothing.
//
// 2. **It is written through db.js, not into the tables.** writeAll() is what
//    the server's own PUT /api/data uses, and readAll() is what /api/data
//    returns. Hand-written INSERTs would drift from both the moment a column
//    moved, and the drift would be invisible: the run would keep printing
//    numbers, just not numbers about this app.
//
// Nothing here is a test fixture in the assert sense. It is scenery, and its
// only job is to be as wide as reality gets.

const db = require('./../db.js');

// German is the shipped default and therefore what the labels are measured in.
// The Portuguese labels are the long ones (BEFUNDE B25 in the responsive plan
// measured 145px for "Davon vorgemerkt"), and covering those is the job of the
// gutter work in P5 rather than of this file.
const LANG_NOTE = 'Kontrolle am 14. Tag, Kontamination am Beutelboden gepruft, Charge bleibt vorerst in Quarantane';

const STRAINS = [
  { species: 'Austernseitling', name: 'Blauer Austernseitling', kuerzel: 'PLE-OST-BLAU' },
  { species: 'Igelstachelbart', name: "Igelstachelbart (Lion's Mane)", kuerzel: 'HER-ERI-2201' },
  { species: 'Kastanienpilz', name: 'Kastanienpilz / Pioppino', kuerzel: 'AGR-AEG-0417' },
  { species: 'Shiitake', name: 'Shiitake Waldkultur', kuerzel: 'LEN-EDO-88' },
  { species: 'Kräuterseitling', name: 'Kräuterseitling König', kuerzel: 'PLE-ERY-K12' }
];

const ZONES = [
  { id: 'INK', name: 'Inkubation Halle Nord', role: 'incubation', color: '#8b5cf6', sortOrder: 1 },
  { id: 'FRU', name: 'Fruchtungskammer 2 (Klimaregelung)', role: 'fruiting', color: '#22c55e', sortOrder: 2 },
  { id: 'LAG', name: 'Kühllager Pommernstraße', role: 'storage', color: '#0ea5e9', sortOrder: 3 }
];

// No Date.now() surprises to explain later: the caller passes a base so the
// same fixture can be rebuilt to the same shape.
//
// ⚠️ Freezing the DATA was only half of it, and the other half went unnoticed
// until 25.08. The app renders against the browser's clock, so a fixture pinned
// to one morning slides past the overdue boundary a day at a time: three lines
// of the Arbeitsgänge census had moved by then, and the census is meant to be
// the thing that does not move. measure-mobile.js now offsets the page's clock
// to this same instant, which is why it needs the number by name.
const BASIS = Date.parse('2026-08-21T08:00:00Z');

function iso(base, daysFromNow) {
  return new Date(base + daysFromNow * 86400000).toISOString();
}

const BATCHES = [
  { id: 'C-2601', strain: 0, qty: 24, days: 14, offset: -21, status: 'inkubation' },
  { id: 'C-2602', strain: 1, qty: 8, days: 21, offset: -18, status: 'fruchtung' },
  { id: 'C-2603', strain: 2, qty: 16, days: 18, offset: -12, status: 'fruchtung' },
  { id: 'C-2604', strain: 3, qty: 32, days: 28, offset: -6, status: 'inkubation' },
  { id: 'C-2605', strain: 4, qty: 12, days: 16, offset: -2, status: 'inkubation' },
  { id: 'C-2606', strain: 0, qty: 40, days: 14, offset: 0, status: 'inkubation' }
];

/**
 * Fill a freshly created database.
 *
 * `base` is a millisecond timestamp; everything dated is derived from it, so a
 * rebuilt fixture has the same shape rather than drifting with the clock.
 */
function seed(database, base = BASIS) {
  // A Sorte carries name, Kürzel and description and nothing else — the species
  // lives on the batch. The pair `Name (KÜRZEL)` is the key the shop matches a
  // release against, spelled exactly, so the fixture spells it that way
  // wherever a strainText is written below.
  const strainIds = STRAINS.map((s) =>
    Number(
      db.createMushroomStrain(database, {
        name: s.name,
        kuerzel: s.kuerzel,
        description: LANG_NOTE
      })
    )
  );

  const data = {
    zones: ZONES.map((z) => ({ ...z, racks: [] })),
    batches: BATCHES.map((b) => ({
      batchId: b.id,
      species: STRAINS[b.strain].species,
      strain: STRAINS[b.strain].name,
      strainId: strainIds[b.strain],
      strainText: `${STRAINS[b.strain].name} (${STRAINS[b.strain].kuerzel})`,
      qty: b.qty,
      days: b.days,
      bagKg: 2.5,
      batchType: 'bags',
      notes: LANG_NOTE,
      created: iso(base, b.offset),
      due: iso(base, b.offset + b.days),
      substrate: { hardwood: 60, wheatbran: 20, rh: 55, gypsum: 2, coir: 18 },
      // `id`, not `bagId`: writeAll reads item.id for a bag object (db.js:2905)
      // and item.bagId binds undefined, which SQLite refuses.
      bags: Array.from({ length: Math.min(b.qty, 6) }, (_, i) => ({
        id: `${b.id}-${String(i + 1).padStart(2, '0')}`,
        bagKg: 2.5
      }))
    })),
    scanLog: BATCHES.slice(0, 4).map((b, i) => ({
      time: iso(base, b.offset + 1),
      action: b.status === 'fruchtung' ? 'fruiting' : 'incubation',
      batch: b.id,
      bag: `${b.id}-01`,
      from: ZONES[0].id,
      to: ZONES[(i + 1) % ZONES.length].id,
      species: STRAINS[b.strain].species,
      strain: STRAINS[b.strain].name
    })),
    harvests: BATCHES.slice(1, 4).map((b, i) => ({
      time: iso(base, b.offset + b.days),
      batch: b.id,
      bag: `${b.id}-01`,
      species: STRAINS[b.strain].species,
      strain: STRAINS[b.strain].name,
      grams: 1240 + i * 380,
      flush: 1,
      quality: 'A',
      notes: LANG_NOTE
    })),
    cultures: STRAINS.slice(0, 4).map((s, i) => ({
      id: `cult-${i + 1}`,
      type: ['agar', 'lc', 'grain', 'agar'][i],
      species: s.species,
      strain: s.name,
      strainText: `${s.name} (${s.kuerzel})`,
      created: iso(base, -40 + i * 5),
      notes: LANG_NOTE,
      status: 'active'
    })),
    manualTasks: [
      {
        text: 'Fruchtungskammer 2 entkeimen und Luftbefeuchter-Filter tauschen',
        done: false,
        priority: 'high',
        created: iso(base, -2),
        assignee: 'A. Beispiel',
        dueDate: iso(base, 1).slice(0, 10)
      },
      {
        text: 'Körnerbrut für die Woche 36 ansetzen, 12 Gläser Weizen',
        done: false,
        priority: 'med',
        created: iso(base, -1),
        dueDate: iso(base, 3).slice(0, 10)
      },
      {
        text: 'Marktstand Musterstadt Grüner Markt vorbereiten',
        done: true,
        priority: 'low',
        created: iso(base, -4),
        dueDate: iso(base, -1).slice(0, 10)
      }
    ],
    teamMembers: [
      { name: 'A. Beispiel', role: 'admin', added: iso(base, -90) },
      { name: 'Jonas', role: 'user', added: iso(base, -60) }
    ]
  };

  db.writeAll(database, data);

  // Pickup locations and suppliers have their own upserts rather than a section
  // in writeAll, so they are written the same way the app writes them.
  db.upsertPickupLocation(database, {
    name: 'Marktstand Musterstadt Grüner Markt',
    address: 'Musterweg 1, 00000 Musterstadt',
    active: 1
  });
  db.upsertPickupLocation(database, {
    name: 'Abholstelle Musterstadt Süd',
    address: 'Beispielstraße 49, 00000 Musterstadt',
    active: 1
  });
  db.upsertSupplier(database, {
    mat: 'hardwood',
    name: 'Holzwerke Oberfranken GmbH & Co. KG',
    url: 'https://holzwerke-oberfranken.example/pellets',
    phone: '+49 9131 000000',
    notes: 'Hartholzpellets, Lieferzeit 10 Werktage, Mindestabnahme 500 kg'
  });
  db.upsertSupplier(database, {
    mat: 'grain',
    name: 'Mühle Mittelfranken Weizen & Roggen',
    notes: 'Weizen 25-kg-Sack, Abholung Dienstag'
  });

  return { strainIds, batches: BATCHES.map((b) => b.id) };
}

module.exports = { seed, BASIS, STRAINS, ZONES, BATCHES };
