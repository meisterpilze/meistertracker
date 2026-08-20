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

// Every outbound provider call gets a hard timeout: without it a stalled request
// hangs for minutes and (for a label buy) wedges the caller's in-flight lock.
// AbortSignal.timeout aborts the fetch, surfacing as a normal caught error.
const FETCH_TIMEOUT_MS = 15000;
function tfetch(url, opts) {
  return globalThis.fetch(url, { ...opts, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

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
  // Wix fills streetAddress.number on only a minority of orders (41 of 151 in the
  // live shop); the rest carry the number inside the street line. Use the shared
  // splitter so Wix, Etsy and eBay all resolve house numbers identically.
  if (street && !house) {
    const sp = _splitHouse(street);
    street = sp.street;
    house = sp.house;
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
  const res = await tfetch(WIX_BASE + '/ecom/v1/orders/search', {
    method: 'POST',
    headers,
    body: JSON.stringify({ search: { cursorPaging } })
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Wix HTTP ' + res.status);
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
    const res = await tfetch(
      WIX_BASE + '/ecom/v1/fulfillments/orders/' + encodeURIComponent(wixOrderId) + '/create-fulfillment',
      { method: 'POST', headers, body: JSON.stringify(body) }
    );
    if (!res.ok) throw new Error('Wix fulfillment HTTP ' + res.status);
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
  if (!res.ok) throw new Error(label + ' HTTP ' + res.status);
  return text ? JSON.parse(text) : {};
}
// Channels rarely send a separate house number; it arrives embedded in the street
// line. German-style addresses put it last ("Musterweg 18"), while French, Dutch,
// Belgian and Irish ones put it first ("12 Rue de la Paix") — and we ship EU-wide,
// so both occur. Try trailing first (the local convention and the common case),
// then leading. A range ("18-20") or a letter suffix ("18a") counts as one house
// number. Anything matching neither is left alone rather than guessed at: a wrong
// house number prints a wrong label, and the shipping guard would rather stop and
// ask than ship to an address we invented. Shared by all three channels.
const _HOUSE_NUM = '\\d+\\s*(?:[-/]\\s*\\d+)?\\s*[a-zA-Z]?';
function _splitHouse(street) {
  if (!street) return { street: street || null, house: null };
  const s = String(street).trim();
  const trailing = s.match(new RegExp('^(.*\\S)\\s+(' + _HOUSE_NUM + ')$'));
  if (trailing) return { street: trailing[1], house: trailing[2].replace(/\s+/g, '') };
  // Leading form: the remainder must start with a non-digit, so "12 3rd Ave" is
  // left for a human rather than split at the wrong number.
  const leading = s.match(new RegExp('^(' + _HOUSE_NUM + ')\\s+(\\D.*\\S)$'));
  if (leading) return { street: leading[2], house: leading[1].replace(/\s+/g, '') };
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
    const res = await tfetch(ETSY_TOKEN_URL, {
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
    const res = await tfetch(EBAY_TOKEN_URL, {
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
  const res = await tfetch(ETSY_API + '/users/' + encodeURIComponent(uid) + '/shops', { headers: _etsyHeaders(cfg) });
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
    const j = await _json(await tfetch(url, { headers: _etsyHeaders(cfg) }), 'Etsy receipts');
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
    const res = await tfetch(
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
    const res = await tfetch(ETSY_TOKEN_URL, {
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
    const j = await _json(await tfetch(EBAY_API + '/order?limit=1', { headers: _ebayHeaders(cfg) }), 'eBay test');
    return { ok: true, account: 'Bestellungen: ' + (j.total != null ? j.total : (j.orders || []).length) };
  },
  // Unfulfilled orders → upsertOrder shape. Pages via offset cursor.
  async fetchOrders(cfg, { cursor } = {}) {
    if (!cfg.accessToken) throw new Error('eBay nicht verbunden');
    const limit = 50;
    const filter = encodeURIComponent('orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}');
    let url = EBAY_API + '/order?filter=' + filter + '&limit=' + limit;
    if (cursor) url += '&offset=' + encodeURIComponent(cursor);
    const j = await _json(await tfetch(url, { headers: _ebayHeaders(cfg) }), 'eBay orders');
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
    const res = await tfetch(EBAY_API + '/order/' + encodeURIComponent(orderId) + '/shipping_fulfillment', {
      method: 'POST',
      headers: _ebayHeaders(cfg, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(body)
    });
    await _json(res, 'eBay fulfillment'); // 201 Created, empty body
    return { ok: true };
  },
  async refreshAccessToken(cfg) {
    const basic = Buffer.from((cfg.clientId || '') + ':' + (cfg.clientSecret || '')).toString('base64');
    const res = await tfetch(EBAY_TOKEN_URL, {
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

// ── Billbee ──────────────────────────────────────────────────────────────────
// https://api.billbee.io/api/v1 (spec: https://app.billbee.io/swagger/docs/v1)
//
// Billbee is not a shop. It is the merchant's own order hub: it already holds the
// orders of every channel they sell on, and it already pushes stock out to all of
// them. That makes this provider the odd one out twice over.
//
// **Orders arrive already merged**, each naming the shop it came from. They are
// all imported under the channel 'billbee' rather than re-attributed to
// 'etsy'/'ebay' the way _wixOriginChannel does, and that is deliberate: orders
// dedupe on (channel, channelOrderId), and Billbee's order id has nothing to do
// with eBay's. Re-attributing would file the same sale twice — once from each
// side — instead of merging the two. So when Billbee is on, the direct connection
// for every shop it covers belongs off. The shop name still travels in raw_json.
//
// **Stock travels the other way**, and that is the reason to connect Billbee at
// all: one updatestockmultiple call and every connected shop hears the new
// release. See pushStock.
//
// Credentials reuse the existing columns, so there is no migration: api_key holds
// the app's X-Billbee-Api-Key, client_id the Billbee login, client_secret the API
// password from the Billbee account settings. The key has to be requested from
// Billbee and the API switched on in the account — neither is something this code
// can do, and both fail as a plain 401 here.
const BILLBEE_API = 'https://api.billbee.io/api/v1';
// Billbee throttles per endpoint: 2 calls/second for one API key + user, answered
// with 429 + Retry-After. The sync loop pages faster than that, so the calls are
// spaced here instead of the limit being discovered on a live account.
const BILLBEE_MIN_GAP_MS = 550;
const BILLBEE_PAGE_SIZE = 250; // the documented maximum
// How far back a sync looks. Without a floor every poll would walk the entire
// order history of every connected channel — and the sync route stops after 20
// pages regardless, so the walk would never reach today's orders.
const BILLBEE_WINDOW_DAYS = 30;
// Stock is pushed in chunks: one body per few hundred articles keeps a partial
// failure readable (Billbee answers per article) and the request small.
const BILLBEE_STOCK_CHUNK = 50;

// One queue for every Billbee call in this process, spaced by BILLBEE_MIN_GAP_MS.
// Per endpoint would be closer to what Billbee actually limits, but the sync and
// the stock push never run hot at the same time, and one queue cannot be got
// wrong.
let _billbeeQueue = Promise.resolve();
let _billbeeLast = 0;
function _billbeeGate(fn) {
  const run = _billbeeQueue.then(async () => {
    const wait = BILLBEE_MIN_GAP_MS - (Date.now() - _billbeeLast);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await fn();
    } finally {
      _billbeeLast = Date.now();
    }
  });
  // The chain has to survive a rejection: chaining on `run` itself would leave
  // every later call queued behind a rejected promise and never run again.
  _billbeeQueue = run.then(
    () => {},
    () => {}
  );
  return run;
}

function _billbeeHeaders(cfg, hasBody) {
  const h = {
    'X-Billbee-Api-Key': cfg.apiKey,
    Authorization: 'Basic ' + Buffer.from(cfg.clientId + ':' + cfg.clientSecret).toString('base64'),
    Accept: 'application/json'
  };
  if (hasBody) h['Content-Type'] = 'application/json';
  return h;
}

async function _billbeeFetch(cfg, pathAndQuery, opts = {}, label = 'Billbee') {
  if (!cfg.apiKey) throw new Error('Billbee API-Key fehlt');
  if (!cfg.clientId || !cfg.clientSecret) throw new Error('Billbee Benutzer + API-Passwort erforderlich');
  const url = BILLBEE_API + pathAndQuery;
  const init = { ...opts, headers: _billbeeHeaders(cfg, !!opts.body) };
  let res = await _billbeeGate(() => tfetch(url, init));
  if (res.status === 429) {
    // Retry once, honouring Retry-After. Capped, because this wait sits inside the
    // caller's own request: a minute of sleeping would look like a hung server.
    const asked = parseInt(res.headers.get('retry-after') || '', 10);
    const after = Math.min(Number.isFinite(asked) && asked >= 0 ? asked : 2, 10);
    await new Promise((r) => setTimeout(r, after * 1000));
    res = await _billbeeGate(() => tfetch(url, init));
  }
  return _json(res, label);
}

// Billbee's carrier ids are account-independent but the spec does not list them,
// so they are read once per process from the API instead of being hard-coded from
// a guess. A miss is not an error: the Sendungsnummer is what matters, and the
// carrier name still travels in the comment.
let _billbeeCarriers = null;
async function _billbeeCarrierId(cfg, carrier) {
  const want = String(carrier || '')
    .trim()
    .toLowerCase();
  if (!want) return null;
  if (!_billbeeCarriers) {
    let j;
    try {
      j = await _billbeeFetch(cfg, '/enums/shippingcarriers', {}, 'Billbee Versanddienstleister');
    } catch {
      // Not cached: a transient failure must not disable carrier ids for the
      // lifetime of the server.
      return null;
    }
    const data = (j && j.Data) || j || {};
    // The endpoint is typed as a bare object in the spec. Accept both shapes it
    // can take — a list of {Id, Name} and an id → name map — rather than pick one.
    const rows = Array.isArray(data)
      ? data.map((e) => ({ id: Number(e.Id != null ? e.Id : e.id), name: String(e.Name || e.name || '') }))
      : Object.entries(data).map(([k, v]) => ({ id: Number(k), name: String(v == null ? '' : v) }));
    _billbeeCarriers = rows.filter((r) => Number.isFinite(r.id) && r.name);
  }
  const hit = _billbeeCarriers.find((c) => {
    const n = c.name.toLowerCase();
    return want === n || want.includes(n) || n.includes(want);
  });
  return hit ? hit.id : null;
}

// Billbee's OrderStateEnum: 4 = shipped, 6 = deleted, 7 = closed, 8 = cancelled.
// ShippedAt is checked alongside the number and is what makes a wrong one
// harmless — a shipped order carries the timestamp whatever its state id says.
function _billbeeStatus(o) {
  const s = Number(o.State);
  if (s === 6 || s === 8) return 'cancelled';
  if (o.ShippedAt || s === 4 || s === 7) return 'shipped';
  return 'new';
}

function _normalizeBillbee(o) {
  const ship = o.ShippingAddress || {};
  const inv = o.InvoiceAddress || {};
  const buyer = o.Buyer || {};
  const cust = o.Customer || {};
  const name =
    [ship.FirstName, ship.LastName].filter(Boolean).join(' ') ||
    ship.Company ||
    buyer.FullName ||
    cust.Name ||
    [inv.FirstName, inv.LastName].filter(Boolean).join(' ') ||
    null;
  // Billbee has a house-number field, but only the channels that send one fill it.
  // Fall back to the shared splitter so all four channels resolve it identically.
  let street = ship.Street || null;
  let house = ship.HouseNumber || null;
  if (street && !house) {
    const sp = _splitHouse(street);
    street = sp.street;
    house = sp.house;
  }
  const items = (o.OrderItems || [])
    // Coupons and discounts arrive as positions like any other. They are not
    // things to make, and importing them parks a "Gutschein" line in the mapping
    // screen for ever, waiting to be bound to a product that cannot exist.
    .filter((li) => li && !li.IsCoupon)
    .map((li) => {
      const p = li.Product || {};
      // A missing quantity means one. Number(null) is 0, so the null case has to
      // be excluded before the finite check, or a position without a quantity
      // would import as zero.
      const qty = li.Quantity != null && Number.isFinite(Number(li.Quantity)) ? Number(li.Quantity) : 1;
      return {
        channelSku: p.SKU || p.SkuOrId || li.InvoiceSKU || null,
        listingId: p.Id != null ? String(p.Id) : null,
        title: p.Title || null,
        qty,
        // Billbee reports the position total (unit price × quantity); the hub
        // stores the unit price.
        unitPrice: li.TotalPrice != null && qty ? Math.round((Number(li.TotalPrice) / qty) * 10000) / 10000 : null
      };
    });
  // TotalCost is documented as the total *without* shipping, unlike the other
  // three channels' totals, so the shipping cost is added back — otherwise the
  // hub under-reports every Billbee order by its postage.
  //
  // ⚠️ That reading is the API documentation's, and it cannot be checked from
  // here; several Billbee clients treat TotalCost as the whole order. Read the
  // wrong way it would *over*-report every order by its postage instead, and
  // nothing about the number would look wrong. So a paid order is believed over
  // the arithmetic: PaidAmount is what the buyer actually handed over, and it is
  // right whichever way the documentation is meant.
  //
  // Rounded because it is money and this is the one channel where two figures are
  // added: 24.90 + 4.90 lands on 29.799999999999997 in binary floating point.
  const summed =
    o.TotalCost != null ? Number(o.TotalCost) + (o.ShippingCost != null ? Number(o.ShippingCost) : 0) : null;
  const paid = o.PayedAt && o.PaidAmount != null ? Number(o.PaidAmount) : null;
  const chosen = paid != null && paid > 0 ? paid : summed;
  const total = chosen != null && Number.isFinite(chosen) ? Math.round(chosen * 100) / 100 : null;
  return {
    channel: 'billbee',
    // The *internal* Billbee id — not Id or OrderNumber, which belong to the
    // marketplace the order came from. It is the only key that is unique across
    // channels, and it is the one /orders/{id}/shipment takes.
    channelOrderId: o.BillBeeOrderId != null ? String(o.BillBeeOrderId) : null,
    status: _billbeeStatus(o),
    orderDate: o.CreatedAt || null,
    customerName: name,
    customerEmail: ship.Email || inv.Email || buyer.Email || cust.Email || null,
    // Marketplaces mask the buyer's email (eBay does), and then the platform
    // handle is the only stable dedup key. Prefixed with the platform because the
    // id is theirs, not Billbee's, and two platforms can hand out the same number.
    buyerHandle: buyer.Id ? String(buyer.Platform || 'billbee').toLowerCase() + ':' + buyer.Id : null,
    shipCountry: ship.CountryISO2 || null,
    totalAmount: total != null && Number.isFinite(total) ? total : null,
    currency: o.Currency || null,
    shipName: name,
    shipCompany: ship.Company || null,
    shipStreet: street,
    shipHouse: house,
    shipAddress2: ship.Line2 || ship.NameAddition || null,
    shipCity: ship.City || null,
    shipPostal: ship.Zip || null,
    shipPhone: ship.Phone || null,
    shipWeightG:
      o.ShipWeightKg != null && Number.isFinite(Number(o.ShipWeightKg))
        ? Math.round(Number(o.ShipWeightKg) * 1000)
        : null,
    raw: o,
    items
  };
}

const billbee = {
  async testConnection(cfg) {
    const j = await _billbeeFetch(cfg, '/shopaccounts?page=1&pageSize=50', {}, 'Billbee Shopkonten');
    const shops = ((j && j.Data) || []).map((s) => s && s.Name).filter(Boolean);
    // The connected shops are the useful answer here: they are exactly the list of
    // channels that must now be switched off on this page.
    return { ok: true, account: shops.length ? shops.join(', ') : 'Billbee', sample: shops.length, shops };
  },
  // Orders of the last BILLBEE_WINDOW_DAYS days. The cursor is `page|since`, and
  // it carries the window start for a reason: recomputing "30 days ago" on every
  // page moves the filter underneath the paging. An order sitting on the boundary
  // then drops out between two requests, every later order shifts up one place,
  // and whichever order that pushes across the page break is not returned by that
  // sync at all — silent loss, not a delay, for an order never imported before.
  async fetchOrders(cfg, { cursor } = {}) {
    const [rawPage, rawSince] = String(cursor == null ? '' : cursor).split('|');
    const page = Math.max(1, parseInt(rawPage, 10) || 1);
    const since = rawSince || new Date(Date.now() - BILLBEE_WINDOW_DAYS * 86400000).toISOString();
    const q = _form({ page, pageSize: BILLBEE_PAGE_SIZE, minOrderDate: since });
    const j = await _billbeeFetch(cfg, '/orders?' + q, {}, 'Billbee Aufträge');
    const rows = (j && j.Data) || [];
    // An order without an internal id cannot be deduped or written back to, and
    // upsertOrder would throw on it mid-batch. Drop it here instead.
    const orders = rows.map(_normalizeBillbee).filter((o) => o.channelOrderId);
    const totalPages = (j && j.Paging && j.Paging.TotalPages) || 0;
    const nextCursor = rows.length && page < totalPages ? page + 1 + '|' + since : null;
    return { orders, nextCursor };
  },
  // Write the Sendungsnummer back onto the Billbee order. Best-effort, like the
  // other three: the caller records the outcome and never fails a bought label
  // over a write-back error.
  async pushTracking(cfg, { raw, trackingNumber, trackingUrl, carrier }) {
    const id = raw && raw.BillBeeOrderId;
    if (id == null) throw new Error('Billbee-Auftragsnummer fehlt');
    const body = { ShippingId: trackingNumber || '', ShipmentType: 0 };
    const carrierId = await _billbeeCarrierId(cfg, carrier);
    if (carrierId != null) body.CarrierId = carrierId;
    // The carrier name travels even when it mapped to an id: Billbee shows the
    // comment on the shipment, and an unmapped carrier would arrive nameless.
    const note = [carrier, trackingUrl].filter(Boolean).join(' · ');
    if (note) body.Comment = note;
    await _billbeeFetch(
      cfg,
      '/orders/' + encodeURIComponent(id) + '/shipment',
      { method: 'POST', body: JSON.stringify(body) },
      'Billbee Sendungsnummer'
    );
    return { ok: true };
  },
  /**
   * Push absolute stock levels to Billbee, which forwards them to every connected
   * shop. `items` is `[{ sku, qty, reason }]` — what a level *is* is a question
   * about this lab's releases, so db.billbeeStockLevels() answers it and this only
   * carries the answer.
   *
   * Returns `{ pushed, failed, results }`; a per-article error from Billbee is
   * reported, never thrown, so one unknown SKU cannot stop the rest of a push.
   */
  async pushStock(cfg, items) {
    const list = (items || []).filter((i) => i && i.sku);
    const results = [];
    let pushed = 0;
    let failed = 0;
    for (let i = 0; i < list.length; i += BILLBEE_STOCK_CHUNK) {
      const slice = list.slice(i, i + BILLBEE_STOCK_CHUNK);
      const body = slice.map((it) => ({
        Sku: it.sku,
        NewQuantity: it.qty,
        Reason: it.reason || 'Meistertracker',
        // Billbee knows about orders that are not shipped yet; a release does not.
        // Without this, a release of 2 kg would be republished in full to every
        // shop even after 1.5 kg of it had already been sold through one of them.
        AutosubtractReservedAmount: true
      }));
      const j = await _billbeeFetch(
        cfg,
        '/products/updatestockmultiple',
        { method: 'POST', body: JSON.stringify(body) },
        'Billbee Bestand'
      );
      const rows = Array.isArray(j) ? j : [j];
      rows.forEach((r, n) => {
        const data = (r && r.Data) || {};
        const err = (r && r.ErrorMessage) || data.Message || null;
        const sku = data.SKU || (slice[n] && slice[n].sku) || null;
        // Billbee answers 200 with an ErrorMessage per article for the ordinary
        // failure — an SKU it does not know. That is a failure, not a push.
        if (r && r.ErrorMessage) failed++;
        else pushed++;
        results.push({ sku, qty: slice[n] ? slice[n].qty : null, stock: data.CurrentStock, message: err });
      });
    }
    return { pushed, failed, results };
  }
};

function getChannelProvider(channel) {
  if (channel === 'wix') return wix;
  if (channel === 'ebay') return ebay;
  if (channel === 'etsy') return etsy;
  if (channel === 'billbee') return billbee;
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
  billbee,
  _normalizeWix,
  _normalizeEtsy,
  _normalizeEbay,
  _normalizeBillbee,
  _billbeeStatus,
  _splitHouse,
  WIX_BASE
};
