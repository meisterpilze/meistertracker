'use strict';
// Provider-agnostic sales-channel sync. Each provider fetches orders and returns
// them normalized to the db.upsertOrder() shape so order/customer/item insertion
// is reused. Uses global fetch (Node >= 22, see package.json engines).
//
// Wix: API key + Site ID (no OAuth) — works anywhere, incl. the worktree.
// eBay/Etsy: OAuth 2.0 — added with their auth flows (stubs throw clearly here).

const WIX_BASE = 'https://www.wixapis.com';

function _wixStatus(o) {
  const s = String(o.status || '').toUpperCase();
  if (s === 'CANCELED' || s === 'CANCELLED') return 'cancelled';
  const f = String(o.fulfillmentStatus || '').toUpperCase();
  if (f === 'FULFILLED') return 'shipped';
  return 'new';
}

// Wix aggregates orders from connected channels; channelInfo.type carries the
// true origin (WEB / EBAY / ETSY / AMAZON / POS …). Attribute the order to it so
// the hub shows the real channel — a single Wix key then covers all of them.
function _wixOriginChannel(o) {
  const t = ((o.channelInfo && (o.channelInfo.type || o.channelInfo.channelType)) || '').toUpperCase();
  if (t === 'EBAY') return 'ebay';
  if (t === 'ETSY') return 'etsy';
  return 'wix';
}

// Map one Wix eCommerce order (ecom/v1) to the upsertOrder shape. Field paths are
// best-effort against the documented API; verify against a real order and adjust.
function _normalizeWix(o) {
  const rec = o.recipientInfo || {};
  const contact = rec.contactDetails || (o.billingInfo && o.billingInfo.contactDetails) || {};
  const addr =
    rec.address ||
    (rec.shippingDestination && rec.shippingDestination.address) ||
    (o.billingInfo && o.billingInfo.address) ||
    {};
  const name = [contact.firstName, contact.lastName].filter(Boolean).join(' ') || null;
  const total =
    o.priceSummary && o.priceSummary.total && o.priceSummary.total.amount != null
      ? parseFloat(o.priceSummary.total.amount)
      : null;
  let street = addr.streetAddress ? addr.streetAddress.name : addr.addressLine1 || addr.addressLine || null;
  let house = addr.streetAddress && addr.streetAddress.number ? addr.streetAddress.number : null;
  // Wix sometimes embeds the house number in the street line ("Markgrafenallee 18")
  // and leaves number empty — split it off so labels get a clean house_number.
  if (street && !house) {
    const m = street.match(/^(.*\S)\s+(\d+\s*[a-zA-Z]?)$/);
    if (m) {
      street = m[1];
      house = m[2].replace(/\s+/g, '');
    }
  }
  const items = (o.lineItems || []).map((li) => ({
    channelSku:
      (li.physicalProperties && li.physicalProperties.sku) ||
      (li.catalogReference && li.catalogReference.catalogItemId) ||
      null,
    listingId: (li.catalogReference && li.catalogReference.catalogItemId) || null,
    title: (li.productName && (li.productName.original || li.productName.translated)) || li.itemName || null,
    qty: li.quantity || 1,
    unitPrice: li.price && li.price.amount != null ? parseFloat(li.price.amount) : null
  }));
  return {
    channel: _wixOriginChannel(o),
    channelOrderId: o.number != null ? String(o.number) : String(o.id),
    status: _wixStatus(o),
    orderDate: o.createdDate || o._createdDate || o.dateCreated || null,
    customerName: name,
    customerEmail: (o.buyerInfo && o.buyerInfo.email) || contact.email || null,
    shipCountry: addr.country || null,
    totalAmount: total,
    currency: o.currency || (o.priceSummary && o.priceSummary.total && o.priceSummary.total.currency) || null,
    shipName: name,
    shipCompany: contact.company || null,
    shipStreet: street,
    shipHouse: house,
    shipAddress2: addr.addressLine2 || null,
    shipCity: addr.city || null,
    shipPostal: addr.postalCode || null,
    shipPhone: contact.phone || null,
    raw: o,
    items
  };
}

async function _wixSearch(cfg, cursorPaging) {
  const headers = {
    Authorization: cfg.apiKey,
    'wix-site-id': cfg.siteId,
    'Content-Type': 'application/json'
  };
  // API-key calls to Wix usually also require the account id. For Wix we store it
  // in the (otherwise-unused) client_id column.
  if (cfg.clientId) headers['wix-account-id'] = cfg.clientId;
  const res = await fetch(WIX_BASE + '/ecom/v1/orders/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({ search: { cursorPaging } })
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Wix HTTP ' + res.status + (text ? ': ' + text.slice(0, 200) : ''));
  return text ? JSON.parse(text) : {};
}

const wix = {
  async testConnection(cfg) {
    if (!cfg.apiKey || !cfg.siteId) throw new Error('API-Key + Site-ID erforderlich');
    const j = await _wixSearch(cfg, { limit: 1 });
    return { ok: true, account: cfg.siteId, sample: (j.orders || []).length };
  },
  async fetchOrders(cfg, { cursor } = {}) {
    if (!cfg.apiKey || !cfg.siteId) throw new Error('API-Key + Site-ID erforderlich');
    const j = await _wixSearch(cfg, cursor ? { cursor } : { limit: 50 });
    const orders = (j.orders || []).map(_normalizeWix);
    const nextCursor = (j.metadata && j.metadata.cursors && j.metadata.cursors.next) || null;
    return { orders, nextCursor };
  }
};

const ebay = {
  async testConnection() {
    throw new Error('eBay benötigt OAuth — Developer-App + Anmeldung folgt');
  },
  async fetchOrders() {
    throw new Error('eBay benötigt OAuth — Developer-App + Anmeldung folgt');
  }
};
const etsy = {
  async testConnection() {
    throw new Error('Etsy benötigt OAuth — Developer-App + Anmeldung folgt');
  },
  async fetchOrders() {
    throw new Error('Etsy benötigt OAuth — Developer-App + Anmeldung folgt');
  }
};

function getChannelProvider(channel) {
  if (channel === 'wix') return wix;
  if (channel === 'ebay') return ebay;
  if (channel === 'etsy') return etsy;
  throw new Error('unknown channel: ' + channel);
}

module.exports = { getChannelProvider, wix, _normalizeWix, WIX_BASE };
