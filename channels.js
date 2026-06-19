'use strict';
const crypto = require('crypto');
// Provider-agnostic sales-channel sync. Each provider fetches orders and returns
// them normalized to the db.upsertOrder() shape so order/customer/item insertion
// is reused. Uses global fetch (Node >= 22, see package.json engines).
//
// Wix: API key + Site ID (no OAuth) — works anywhere, incl. the worktree.
// eBay/Etsy: OAuth 2.0 — added with their auth flows (stubs throw clearly here).

const WIX_BASE = 'https://www.wixapis.com';
// Etsy Open API v3 (OAuth2 with PKCE — public app, keystring is the client_id, no
// secret). Token host is api.etsy.com; data endpoints live under openapi.etsy.com.
const ETSY_CONNECT_URL = 'https://www.etsy.com/oauth/connect';
const ETSY_TOKEN_URL = 'https://api.etsy.com/v3/public/oauth/token';
const ETSY_API = 'https://openapi.etsy.com/v3/application';
const ETSY_SCOPES = 'transactions_r transactions_w';
// eBay Sell Fulfillment API (OAuth2 authorization-code; redirect_uri in the flow is
// the RuName, not the literal URL — we store the RuName in the site_id column).
const EBAY_AUTHORIZE_URL = 'https://auth.ebay.com/oauth2/authorize';
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token';
const EBAY_API = 'https://api.ebay.com/sell/fulfillment/v1';
const EBAY_SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.fulfillment';
const EBAY_MARKETPLACE = 'EBAY_DE';
// Cache the Etsy shop id per access token — avoids an extra /users/{id}/shops call
// on every sync page and every write-back (Etsy's rate limit is tight, ~10/s).
const _etsyShopCache = new Map();

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
    // Import only Wix-website (WEB) orders — eBay/Etsy are pulled from their own
    // APIs directly, so we skip Wix's (now-stale) aggregated copies of them.
    const orders = (j.orders || []).map(_normalizeWix).filter((o) => o.channel === 'wix');
    const nextCursor = (j.metadata && j.metadata.cursors && j.metadata.cursors.next) || null;
    return { orders, nextCursor };
  },
  // Push the Sendungsnummer back onto the Wix order (creates a fulfillment with
  // tracking). Same API key — no OAuth. Best-effort; the caller records the
  // outcome and never fails the label purchase over a write-back error.
  async pushTracking(cfg, { raw, trackingNumber, trackingUrl, carrier }) {
    if (!cfg.apiKey || !cfg.siteId) throw new Error('Wix nicht konfiguriert');
    const wixOrderId = raw && raw.id;
    if (!wixOrderId) throw new Error('Wix-Order-ID fehlt');
    const lineItems = (raw.lineItems || []).map((li) => ({ id: li.id, quantity: li.quantity || 1 }));
    const headers = {
      Authorization: cfg.apiKey,
      'wix-site-id': cfg.siteId,
      'Content-Type': 'application/json'
    };
    if (cfg.clientId) headers['wix-account-id'] = cfg.clientId;
    const body = {
      fulfillment: {
        lineItems,
        trackingInfo: {
          trackingNumber: trackingNumber || '',
          shippingProvider: carrier || 'other',
          trackingLink: trackingUrl || undefined
        }
      }
    };
    const res = await fetch(
      WIX_BASE + '/ecom/v1/fulfillments/orders/' + encodeURIComponent(wixOrderId) + '/create-fulfillment',
      { method: 'POST', headers, body: JSON.stringify(body) }
    );
    const text = await res.text();
    if (!res.ok) throw new Error('Wix fulfillment HTTP ' + res.status + (text ? ': ' + text.slice(0, 200) : ''));
    return { ok: true };
  }
};

// ── Shared helpers (eBay + Etsy) ─────────────────────────────────────────────
function _form(obj) {
  return Object.entries(obj)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v))
    .join('&');
}
function _b64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
// PKCE pair for Etsy: a 43-char verifier and its S256 challenge.
function pkcePair() {
  const verifier = _b64url(crypto.randomBytes(32));
  const challenge = _b64url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}
function _expiryIso(expiresInSec) {
  // OAuth token lifetime (seconds). A missing or non-numeric value must NOT be
  // treated as 0 — that stamps the token as already-expired, forcing a refresh
  // before every single call (and `new Date(NaN)` would throw). Fall back to 1h.
  const n = Number(expiresInSec);
  const secs = Number.isFinite(n) && n > 0 ? n : 3600;
  return new Date(Date.now() + secs * 1000).toISOString();
}
async function _json(res, label) {
  const text = await res.text();
  if (!res.ok) throw new Error(label + ' HTTP ' + res.status + (text ? ': ' + text.slice(0, 300) : ''));
  return text ? JSON.parse(text) : {};
}
// DE addresses often embed the house number in the street line ("Musterweg 18").
// Split it off so Sendcloud gets a clean house_number (mirrors the Wix logic).
function _splitHouse(street) {
  if (!street) return { street: street || null, house: null };
  const m = String(street).match(/^(.*\S)\s+(\d+\s*[a-zA-Z]?)$/);
  if (m) return { street: m[1], house: m[2].replace(/\s+/g, '') };
  return { street, house: null };
}

// ── OAuth: authorize URL + code exchange (driven by the server routes) ────────
function buildAuthorizeUrl(channel, cfg, { redirectUri, state, codeChallenge }) {
  if (channel === 'etsy') {
    if (!cfg.clientId) throw new Error('Etsy Keystring fehlt');
    return (
      ETSY_CONNECT_URL +
      '?' +
      _form({
        response_type: 'code',
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        scope: ETSY_SCOPES,
        state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256'
      })
    );
  }
  if (channel === 'ebay') {
    if (!cfg.clientId) throw new Error('eBay App-ID fehlt');
    if (!cfg.siteId) throw new Error('eBay RuName fehlt');
    return (
      EBAY_AUTHORIZE_URL +
      '?' +
      _form({
        client_id: cfg.clientId,
        response_type: 'code',
        redirect_uri: cfg.siteId, // eBay RuName, stored in the site_id column
        scope: EBAY_SCOPES,
        state
      })
    );
  }
  throw new Error('OAuth not supported for channel: ' + channel);
}
async function exchangeCode(channel, cfg, { code, redirectUri, codeVerifier }) {
  if (channel === 'etsy') {
    const res = await fetch(ETSY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: _form({
        grant_type: 'authorization_code',
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        code,
        code_verifier: codeVerifier
      })
    });
    const j = await _json(res, 'Etsy token');
    if (!j.access_token) throw new Error('Etsy token: kein access_token in der Antwort');
    return { accessToken: j.access_token, refreshToken: j.refresh_token, tokenExpires: _expiryIso(j.expires_in) };
  }
  if (channel === 'ebay') {
    const basic = Buffer.from((cfg.clientId || '') + ':' + (cfg.clientSecret || '')).toString('base64');
    const res = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: _form({ grant_type: 'authorization_code', code, redirect_uri: cfg.siteId })
    });
    const j = await _json(res, 'eBay token');
    if (!j.access_token) throw new Error('eBay token: kein access_token in der Antwort');
    return { accessToken: j.access_token, refreshToken: j.refresh_token, tokenExpires: _expiryIso(j.expires_in) };
  }
  throw new Error('OAuth not supported for channel: ' + channel);
}

// ── Etsy (Open API v3, OAuth2 PKCE) ──────────────────────────────────────────
function _etsyHeaders(cfg, extra) {
  return Object.assign({ 'x-api-key': cfg.clientId, Authorization: 'Bearer ' + cfg.accessToken }, extra || {});
}
// The access token is "{user_id}.{token}"; the prefix is the Etsy user id.
function _etsyUserId(cfg) {
  const at = cfg.accessToken || '';
  const dot = at.indexOf('.');
  return dot > 0 ? at.slice(0, dot) : null;
}
async function _etsyShopId(cfg) {
  const uid = _etsyUserId(cfg);
  if (!uid) throw new Error('Etsy nicht verbunden');
  const cached = _etsyShopCache.get(cfg.accessToken);
  if (cached) return cached;
  const res = await fetch(ETSY_API + '/users/' + encodeURIComponent(uid) + '/shops', { headers: _etsyHeaders(cfg) });
  const j = await _json(res, 'Etsy shop');
  const shop = Array.isArray(j.results) ? j.results[0] : j;
  const shopId = shop && (shop.shop_id || shop.shopId);
  if (!shopId) throw new Error('Etsy Shop-ID nicht gefunden');
  if (_etsyShopCache.size > 50) _etsyShopCache.clear();
  _etsyShopCache.set(cfg.accessToken, shopId);
  return shopId;
}
// Etsy money is { amount, divisor, currency_code } (amount is in minor units).
function _etsyMoney(m) {
  if (!m || m.amount == null) return null;
  return Math.round((m.amount / (m.divisor || 100)) * 100) / 100;
}
// Best-effort Sendcloud-carrier → Etsy carrier_name. Verify against Etsy's
// getShippingCarriers for your shipping country and tune as needed.
function _etsyCarrier(carrier) {
  const c = String(carrier || '').toLowerCase();
  if (c.includes('dhl')) return 'dhl-germany';
  if (c.includes('dpd')) return 'dpd-de';
  if (c.includes('hermes')) return 'hermes-de';
  if (c.includes('gls')) return 'gls-de';
  if (c.includes('ups')) return 'ups';
  if (c.includes('post')) return 'deutsche-post';
  return c || 'other';
}
function _normalizeEtsy(r) {
  const sp = _splitHouse(r.first_line || null);
  const created = r.created_timestamp != null ? r.created_timestamp : r.create_timestamp;
  const items = (r.transactions || []).map((t) => ({
    channelSku: t.sku || (t.product_data && t.product_data.sku) || null,
    listingId: t.listing_id != null ? String(t.listing_id) : null,
    title: t.title || null,
    qty: t.quantity || 1,
    unitPrice: _etsyMoney(t.price)
  }));
  return {
    channel: 'etsy',
    channelOrderId: String(r.receipt_id),
    status: r.is_shipped ? 'shipped' : 'new',
    orderDate: created != null ? new Date(created * 1000).toISOString() : null,
    customerName: r.name || null,
    customerEmail: r.buyer_email || null,
    // Stable Etsy buyer id → dedup key when the email is absent (see upsertCustomerFromOrder).
    buyerHandle: r.buyer_user_id != null ? String(r.buyer_user_id) : null,
    shipCountry: r.country_iso || null,
    totalAmount: _etsyMoney(r.grandtotal),
    currency: (r.grandtotal && r.grandtotal.currency_code) || null,
    shipName: r.name || null,
    shipStreet: sp.street,
    shipHouse: sp.house,
    shipAddress2: r.second_line || null,
    shipCity: r.city || null,
    shipPostal: r.zip || null,
    raw: r,
    items
  };
}
const etsy = {
  async testConnection(cfg) {
    if (!cfg.clientId) throw new Error('Etsy Keystring fehlt');
    if (!cfg.accessToken) throw new Error('Etsy nicht verbunden — bitte „Mit Etsy verbinden" klicken');
    const shopId = await _etsyShopId(cfg);
    return { ok: true, account: 'Shop ' + shopId };
  },
  // Open (paid, unshipped) receipts → upsertOrder shape. Pages via offset cursor.
  async fetchOrders(cfg, { cursor } = {}) {
    if (!cfg.accessToken) throw new Error('Etsy nicht verbunden');
    const shopId = await _etsyShopId(cfg);
    const limit = 100;
    const offset = cursor ? parseInt(cursor, 10) || 0 : 0;
    const url =
      ETSY_API +
      '/shops/' +
      encodeURIComponent(shopId) +
      '/receipts?was_paid=true&was_shipped=false&limit=' +
      limit +
      '&offset=' +
      offset;
    const j = await _json(await fetch(url, { headers: _etsyHeaders(cfg) }), 'Etsy receipts');
    const results = j.results || [];
    const orders = results.map(_normalizeEtsy);
    const got = offset + results.length;
    // Page by Etsy's reported total, not page-fullness: a short page that is still
    // below `count` must not stop paging early (which would silently drop orders).
    // results.length > 0 guards against an infinite loop on an unexpected empty page.
    const nextCursor = j.count != null && got < j.count && results.length > 0 ? String(got) : null;
    return { orders, nextCursor };
  },
  // Write the Sendungsnummer back via createReceiptShipment. Best-effort.
  async pushTracking(cfg, { raw, trackingNumber, carrier }) {
    if (!cfg.accessToken) throw new Error('Etsy nicht verbunden');
    const receiptId = raw && raw.receipt_id;
    if (!receiptId) throw new Error('Etsy Receipt-ID fehlt');
    const shopId = await _etsyShopId(cfg);
    const res = await fetch(
      ETSY_API + '/shops/' + encodeURIComponent(shopId) + '/receipts/' + encodeURIComponent(receiptId) + '/tracking',
      {
        method: 'POST',
        headers: _etsyHeaders(cfg, { 'Content-Type': 'application/x-www-form-urlencoded' }),
        body: _form({ tracking_code: trackingNumber || '', carrier_name: _etsyCarrier(carrier) })
      }
    );
    await _json(res, 'Etsy tracking');
    return { ok: true };
  },
  async refreshAccessToken(cfg) {
    const res = await fetch(ETSY_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: _form({ grant_type: 'refresh_token', client_id: cfg.clientId, refresh_token: cfg.refreshToken })
    });
    const j = await _json(res, 'Etsy refresh');
    // A 2xx body without an access_token must not be persisted — it would wipe the
    // working token and brick every later call. Surface it as an error instead.
    if (!j.access_token) throw new Error('Etsy refresh: kein access_token in der Antwort');
    // Etsy rotates the refresh token; keep the stored one if the response omits it
    // (a null/empty value would otherwise brick all future refreshes).
    return {
      accessToken: j.access_token,
      refreshToken: j.refresh_token || cfg.refreshToken,
      tokenExpires: _expiryIso(j.expires_in)
    };
  }
};

// ── eBay (Sell Fulfillment API, OAuth2 authorization-code) ───────────────────
function _ebayHeaders(cfg, extra) {
  return Object.assign(
    { Authorization: 'Bearer ' + cfg.accessToken, 'X-EBAY-C-MARKETPLACE-ID': EBAY_MARKETPLACE },
    extra || {}
  );
}
// Best-effort Sendcloud-carrier → eBay shippingCarrierCode (uppercase enum).
function _ebayCarrier(carrier) {
  const c = String(carrier || '').toLowerCase();
  if (c.includes('dhl')) return 'DHL';
  if (c.includes('dpd')) return 'DPD';
  if (c.includes('hermes')) return 'HERMES';
  if (c.includes('gls')) return 'GLS';
  if (c.includes('ups')) return 'UPS';
  if (c.includes('post')) return 'DEUTSCHE_POST';
  return String(carrier || '').toUpperCase() || 'OTHER';
}
function _normalizeEbay(o) {
  const fsi = (o.fulfillmentStartInstructions && o.fulfillmentStartInstructions[0]) || {};
  const shipTo = (fsi.shippingStep && fsi.shippingStep.shipTo) || {};
  const addr = shipTo.contactAddress || {};
  const total = o.pricingSummary && o.pricingSummary.total;
  const sp = _splitHouse(addr.addressLine1 || null);
  const items = (o.lineItems || []).map((li) => ({
    channelSku: li.sku || null,
    listingId: li.legacyItemId != null ? String(li.legacyItemId) : null,
    title: li.title || null,
    qty: li.quantity || 1,
    unitPrice: li.lineItemCost && li.lineItemCost.value != null ? parseFloat(li.lineItemCost.value) : null
  }));
  return {
    channel: 'ebay',
    channelOrderId: String(o.orderId),
    // We only ever fetch unshipped orders (NOT_STARTED|IN_PROGRESS).
    status: 'new',
    orderDate: o.creationDate || null,
    customerName: shipTo.fullName || (o.buyer && o.buyer.username) || null,
    customerEmail: shipTo.email || null,
    // eBay usually masks the buyer email; the username is the stable dedup key
    // (see upsertCustomerFromOrder), otherwise every sync creates a new customer.
    buyerHandle: (o.buyer && o.buyer.username) || null,
    shipCountry: addr.countryCode || null,
    totalAmount: total && total.value != null ? parseFloat(total.value) : null,
    currency: (total && total.currency) || null,
    shipName: shipTo.fullName || null,
    shipStreet: sp.street,
    shipHouse: sp.house,
    shipAddress2: addr.addressLine2 || null,
    shipCity: addr.city || null,
    shipPostal: addr.postalCode || null,
    shipPhone: (shipTo.primaryPhone && shipTo.primaryPhone.phoneNumber) || null,
    raw: o,
    items
  };
}
const ebay = {
  async testConnection(cfg) {
    if (!cfg.clientId || !cfg.clientSecret) throw new Error('eBay App-ID + Cert-ID fehlen');
    if (!cfg.siteId) throw new Error('eBay RuName fehlt');
    if (!cfg.accessToken) throw new Error('eBay nicht verbunden — bitte „Mit eBay verbinden" klicken');
    const j = await _json(await fetch(EBAY_API + '/order?limit=1', { headers: _ebayHeaders(cfg) }), 'eBay test');
    return { ok: true, account: 'Bestellungen: ' + (j.total != null ? j.total : (j.orders || []).length) };
  },
  // Unfulfilled orders → upsertOrder shape. Pages via offset cursor.
  async fetchOrders(cfg, { cursor } = {}) {
    if (!cfg.accessToken) throw new Error('eBay nicht verbunden');
    const limit = 50;
    const filter = encodeURIComponent('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}');
    let url = EBAY_API + '/order?filter=' + filter + '&limit=' + limit;
    if (cursor) url += '&offset=' + encodeURIComponent(cursor);
    const j = await _json(await fetch(url, { headers: _ebayHeaders(cfg) }), 'eBay orders');
    const orders = (j.orders || []).map(_normalizeEbay);
    let nextCursor = null;
    const off = j.offset != null ? j.offset : cursor ? parseInt(cursor, 10) || 0 : 0;
    if (j.total != null && off + (j.limit || limit) < j.total) nextCursor = String(off + (j.limit || limit));
    return { orders, nextCursor };
  },
  // Write the Sendungsnummer back via createShippingFulfillment. Best-effort.
  async pushTracking(cfg, { raw, order, trackingNumber, carrier }) {
    if (!cfg.accessToken) throw new Error('eBay nicht verbunden');
    const orderId = (raw && raw.orderId) || (order && order.channelOrderId);
    if (!orderId) throw new Error('eBay Order-ID fehlt');
    const lineItems = ((raw && raw.lineItems) || []).map((li) => ({
      lineItemId: li.lineItemId,
      quantity: li.quantity || 1
    }));
    const body = {
      lineItems,
      shippedDate: new Date().toISOString(),
      shippingCarrierCode: _ebayCarrier(carrier),
      shipmentTrackingNumber: trackingNumber || ''
    };
    const res = await fetch(EBAY_API + '/order/' + encodeURIComponent(orderId) + '/shipping_fulfillment', {
      method: 'POST',
      headers: _ebayHeaders(cfg, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    await _json(res, 'eBay fulfillment'); // 201 Created, empty body
    return { ok: true };
  },
  async refreshAccessToken(cfg) {
    const basic = Buffer.from((cfg.clientId || '') + ':' + (cfg.clientSecret || '')).toString('base64');
    const res = await fetch(EBAY_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + basic, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: _form({ grant_type: 'refresh_token', refresh_token: cfg.refreshToken, scope: EBAY_SCOPES })
    });
    const j = await _json(res, 'eBay refresh');
    if (!j.access_token) throw new Error('eBay refresh: kein access_token in der Antwort');
    // The refresh response renews the access token only; keep the existing refresh token.
    return { accessToken: j.access_token, tokenExpires: _expiryIso(j.expires_in) };
  }
};

function getChannelProvider(channel) {
  if (channel === 'wix') return wix;
  if (channel === 'ebay') return ebay;
  if (channel === 'etsy') return etsy;
  throw new Error('unknown channel: ' + channel);
}

module.exports = {
  getChannelProvider,
  buildAuthorizeUrl,
  exchangeCode,
  pkcePair,
  wix,
  etsy,
  ebay,
  _normalizeWix,
  _normalizeEtsy,
  _normalizeEbay,
  WIX_BASE
};
