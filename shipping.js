'use strict';
// Provider-agnostic shipping adapter. Sendcloud is the first implementation;
// add more providers behind getProvider() (e.g. shipcloud) without touching the
// server routes. Uses global fetch (Node >= 22, see package.json engines).
//
// SAFETY: buyLabel() creates a *billable* label at the carrier. It is only ever
// called from POST /api/ship/label, which the user triggers explicitly.

const SENDCLOUD_BASE = 'https://panel.sendcloud.sc/api/v2';

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

  async buyLabel(cfg, { order, methodId, weightG }) {
    const weightKg = ((weightG || cfg.defaultWeightG || 1000) / 1000).toFixed(3);
    const parcel = {
      name: order.shipName || order.customerName || 'Customer',
      company_name: order.shipCompany || '',
      address: order.shipStreet || '',
      house_number: order.shipHouse || '',
      address_2: order.shipAddress2 || '',
      city: order.shipCity || '',
      postal_code: order.shipPostal || '',
      country: (order.shipCountry || 'DE').toUpperCase(),
      telephone: order.shipPhone || '',
      email: order.customerEmail || '',
      order_number: order.channel ? order.channel + '-' + (order.channelOrderId || order.id) : String(order.id || ''),
      weight: weightKg,
      request_label: true,
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
      status: 'created'
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
