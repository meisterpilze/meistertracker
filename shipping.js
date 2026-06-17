'use strict';
// Provider-agnostic shipping adapter. Sendcloud is the first implementation;
// add more providers behind getProvider() (e.g. shipcloud) without touching the
// server routes. Uses global fetch (Node >= 22, see package.json engines).
//
// SAFETY: buyLabel() creates a *billable* label at the carrier. It is only ever
// called from POST /api/ship/label, which the user triggers explicitly.

const SENDCLOUD_BASE = 'https://panel.sendcloud.sc/api/v2';

// Common country names (DE/EN) → ISO-3166 alpha-2. A channel (notably Wix) can
// hand us a full country name; Sendcloud requires the 2-letter code or it
// rejects the parcel. Codes pass through untouched.
const _COUNTRY_ISO2 = {
  germany: 'DE',
  deutschland: 'DE',
  austria: 'AT',
  österreich: 'AT',
  oesterreich: 'AT',
  switzerland: 'CH',
  schweiz: 'CH',
  suisse: 'CH',
  france: 'FR',
  frankreich: 'FR',
  italy: 'IT',
  italien: 'IT',
  spain: 'ES',
  spanien: 'ES',
  portugal: 'PT',
  netherlands: 'NL',
  niederlande: 'NL',
  'the netherlands': 'NL',
  holland: 'NL',
  belgium: 'BE',
  belgien: 'BE',
  belgique: 'BE',
  luxembourg: 'LU',
  luxemburg: 'LU',
  denmark: 'DK',
  dänemark: 'DK',
  daenemark: 'DK',
  sweden: 'SE',
  schweden: 'SE',
  finland: 'FI',
  finnland: 'FI',
  norway: 'NO',
  norwegen: 'NO',
  poland: 'PL',
  polen: 'PL',
  'czech republic': 'CZ',
  czechia: 'CZ',
  tschechien: 'CZ',
  slovakia: 'SK',
  slowakei: 'SK',
  slovenia: 'SI',
  slowenien: 'SI',
  hungary: 'HU',
  ungarn: 'HU',
  croatia: 'HR',
  kroatien: 'HR',
  romania: 'RO',
  rumänien: 'RO',
  rumaenien: 'RO',
  bulgaria: 'BG',
  bulgarien: 'BG',
  greece: 'GR',
  griechenland: 'GR',
  ireland: 'IE',
  irland: 'IE',
  estonia: 'EE',
  estland: 'EE',
  latvia: 'LV',
  lettland: 'LV',
  lithuania: 'LT',
  litauen: 'LT',
  'united kingdom': 'GB',
  'great britain': 'GB',
  uk: 'GB',
  england: 'GB',
  grossbritannien: 'GB',
  großbritannien: 'GB',
  'united states': 'US',
  'united states of america': 'US',
  usa: 'US',
  canada: 'CA',
  kanada: 'CA'
};

function _iso2Country(v) {
  const s = String(v == null ? '' : v).trim();
  if (!s) return 'DE';
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  const hit = _COUNTRY_ISO2[s.toLowerCase()];
  if (hit) return hit;
  throw new Error('Ungültiges Zielland: "' + s + '" — bitte ISO-Ländercode verwenden (z. B. DE).');
}

function scAuth(cfg) {
  return 'Basic ' + Buffer.from((cfg.publicKey || '') + ':' + (cfg.secretKey || '')).toString('base64');
}

async function scFetch(cfg, method, path, body) {
  const res = await fetch(SENDCLOUD_BASE + path, {
    method,
    headers: {
      Authorization: scAuth(cfg),
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch (e) {
    /* non-JSON body */
  }
  if (!res.ok) {
    const e = (json && json.error) || {};
    const msg = e.message || (typeof e === 'string' ? e : '') || 'Sendcloud HTTP ' + res.status;
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return json;
}

const sendcloud = {
  async testConnection(cfg) {
    const j = await scFetch(cfg, 'GET', '/user');
    const u = (j && j.user) || {};
    return { ok: true, account: u.username || u.company_name || 'ok' };
  },

  async listMethods(cfg, { toCountry = 'DE', fromCountry = 'DE', weightG } = {}) {
    const path =
      '/shipping_methods?to_country=' +
      encodeURIComponent(toCountry) +
      '&from_country=' +
      encodeURIComponent(fromCountry);
    const j = await scFetch(cfg, 'GET', path);
    let arr = (j && j.shipping_methods) || [];
    if (weightG) {
      const w = weightG / 1000;
      arr = arr.filter((m) => {
        const lo = m.min_weight != null ? parseFloat(m.min_weight) : 0;
        const hi = m.max_weight != null ? parseFloat(m.max_weight) : 1e9;
        return w >= lo && w <= hi;
      });
    }
    return arr.map((m) => ({
      id: m.id,
      name: m.name,
      carrier: m.carrier,
      minWeight: m.min_weight,
      maxWeight: m.max_weight
    }));
  },

  async buyLabel(cfg, { order, methodId, weightG, requestLabel }) {
    const weightKg = ((weightG || cfg.defaultWeightG || 1000) / 1000).toFixed(3);
    const parcel = {
      name: order.shipName || order.customerName || 'Customer',
      company_name: order.shipCompany || '',
      address: order.shipStreet || '',
      house_number: order.shipHouse || '',
      address_2: order.shipAddress2 || '',
      city: order.shipCity || '',
      postal_code: order.shipPostal || '',
      country: _iso2Country(order.shipCountry),
      telephone: order.shipPhone || '',
      email: order.customerEmail || '',
      order_number: order.channel ? order.channel + '-' + (order.channelOrderId || order.id) : String(order.id || ''),
      weight: weightKg,
      // request_label:false = announce only (no billable label) — used for test mode.
      request_label: requestLabel !== false,
      shipment: { id: Number(methodId) }
    };
    if (cfg.senderAddressId) parcel.sender_address = Number(cfg.senderAddressId);
    const j = await scFetch(cfg, 'POST', '/parcels', { parcel });
    const p = (j && j.parcel) || {};
    const label = p.label || {};
    // label_printer = single PDF sized for label printers (~A6 / 100x150);
    // normal_printer = array of A4 PDF URLs. Prefer the label-printer size.
    const labelUrl = label.label_printer || (Array.isArray(label.normal_printer) && label.normal_printer[0]) || null;
    return {
      providerParcelId: p.id != null ? String(p.id) : null,
      carrier: (p.carrier && (p.carrier.code || p.carrier.name)) || null,
      methodName: (p.shipment && p.shipment.name) || null,
      trackingNumber: p.tracking_number || null,
      trackingUrl: p.tracking_url || null,
      labelUrl,
      labelFormat: label.label_printer ? 'pdf_a6' : 'pdf_a4',
      status: requestLabel === false ? 'announced' : 'created'
    };
  },

  async fetchLabelPdf(cfg, url) {
    const res = await fetch(url, { headers: { Authorization: scAuth(cfg) } });
    if (!res.ok) throw new Error('label fetch HTTP ' + res.status);
    return Buffer.from(await res.arrayBuffer());
  }
};

function getProvider(cfg) {
  const p = (cfg && cfg.provider) || 'sendcloud';
  if (p === 'sendcloud') return sendcloud;
  throw new Error('unknown shipping provider: ' + p);
}

module.exports = { getProvider, sendcloud, _scFetch: scFetch, SENDCLOUD_BASE };
