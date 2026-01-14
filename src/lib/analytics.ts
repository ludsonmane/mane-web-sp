// src/lib/analytics.ts
// Cliente puro — não usa process/import.meta

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    fbq?: (...args: any[]) => void;
    dataLayer?: any[];
    __manePixels?: {
      loadedIds: Set<string>;
      activeId?: string;
      scriptLoaded?: boolean;
      debug?: boolean;
    };
  }
}

const dlog = (...a: any[]) =>
  typeof window !== 'undefined' &&
  window.__manePixels?.debug &&
  console.log('[analytics]', ...a);

/**
 * Normaliza chaves (slug/nome) para bater com o mapa.
 * - mantém hífen
 * - remove acentos
 * - remove pontuação
 */
function normalizeKey(input?: string | null) {
  if (!input) return '';
  const key = input.toString().trim().toLowerCase();
  return key
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // tira acento
    .replace(/\s+/g, ' ')
    .replace(/[^\w\s-]/g, '') // tira pontuação, mantém hífen
    .trim();
}

// ======= MAPA unidade → Pixel ID =======
// Coloque aqui variações que REALMENTE chegam do seu /units (slug, name, etc)
const UNIT_PIXEL_MAP_RAW: Record<string, string> = {
  'mane-west-plaza-sp': '1262593178889667',
  'Mané West Plaza, São Paulo': '1262593178889667',
};

// Mapa normalizado (pra lookup não falhar)
const UNIT_PIXEL_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(UNIT_PIXEL_MAP_RAW).map(([k, v]) => [normalizeKey(k), v])
);

function ensureMetaScript() {
  if (typeof window === 'undefined') return;
  window.__manePixels = window.__manePixels || { loadedIds: new Set() };
  if (window.__manePixels.scriptLoaded) return;

  if (!window.fbq) {
    (function (f: any, b: any, e: any, v: any, n?: any, t?: any, s?: any) {
      if (f.fbq) return;
      n = f.fbq = function () {
        n.callMethod ? n.callMethod.apply(n, arguments) : n.queue.push(arguments);
      };
      if (!f._fbq) f._fbq = n;
      n.push = n;
      n.loaded = !0;
      n.version = '2.0';
      n.queue = [];
      t = b.createElement(e);
      t.async = !0;
      t.src = v;
      s = b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t, s);
    })(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

    dlog('fbq stubbed by analytics.ts (fallback)');
  }

  window.__manePixels.scriptLoaded = true;
}

/**
 * Garante bootstrap mínimo (fbq stub + dataLayer) sem reinjetar nada duplicado
 * + fallback SP por hostname (pra nunca ficar sem pixel na unidade SP)
 */
export function ensureAnalyticsReady() {
  try {
    ensureMetaScript();
    (window as any).dataLayer = (window as any).dataLayer || [];
    window.__manePixels = window.__manePixels || { loadedIds: new Set() };

    // ✅ fallback SP (não cria nada novo, só garante o pixel correto se estiver no host SP)
    try {
      const host = window.location?.hostname || '';
      const isSpHost =
        host.includes('admin-sp.') ||
        host.includes('.sp.') ||
        host.startsWith('sp.') ||
        host.includes('-sp.');

      if (isSpHost) {
        // tenta setar pelo slug conhecido do SP (você pode trocar se o slug real for outro)
        setActiveUnitPixelByKey('mane-west-plaza-sp');
      }
    } catch {}

    dlog('ensureAnalyticsReady: ok');
  } catch (e) {
    console.warn('ensureAnalyticsReady error', e);
  }
}

function ensurePixel(pixelId: string) {
  ensureMetaScript();
  if (!pixelId) return;

  window.__manePixels = window.__manePixels || { loadedIds: new Set() };

  if (!window.__manePixels.loadedIds.has(pixelId)) {
    dlog('fbq init', pixelId);
    window.fbq?.('init', pixelId);
    window.__manePixels.loadedIds.add(pixelId);

    // 🔵 ajuda a aparecer no Pixel Helper vinculado ao ID certo
    try {
      window.fbq?.('trackSingle', pixelId, 'PageView');
      dlog('trackSingle PageView sent for', pixelId);
    } catch (e) {
      console.warn('trackSingle PageView error', e);
    }
  } else {
    dlog('pixel already initialized', pixelId);
  }
}

function findPixelForUnit(input?: string | null): string | undefined {
  if (!input) return;
  const n = normalizeKey(input);

  // tenta direto (slug/nome)
  if (UNIT_PIXEL_MAP[n]) return UNIT_PIXEL_MAP[n];

  // fallback bem simples (evita "inventar" para outras unidades)
  // se você quiser, adicione mais chaves no UNIT_PIXEL_MAP_RAW em vez de heurística.
  return undefined;
}

export function setActiveUnitPixelByKey(unitKeyOrName?: string | null) {
  const id = findPixelForUnit(unitKeyOrName || '');
  if (!id) {
    dlog('no pixel found for', unitKeyOrName);
    return;
  }

  ensurePixel(id);
  window.__manePixels = window.__manePixels || { loadedIds: new Set() };
  window.__manePixels.activeId = id;
  dlog('active pixel set to', id, 'for', unitKeyOrName);
}

export function setActiveUnitPixelFromUnit(
  unit: { id?: string; name?: string | null; slug?: string | null } | string | null | undefined
) {
  if (!unit) return;

  const candidates: string[] = [];
  if (typeof unit === 'string') {
    candidates.push(unit);
  } else {
    if (unit.slug) candidates.push(unit.slug);
    if (unit.name) candidates.push(unit.name);
    if (unit.id) candidates.push(unit.id);
  }

  for (const k of candidates) {
    const id = findPixelForUnit(k);
    if (id) {
      ensurePixel(id);
      window.__manePixels = window.__manePixels || { loadedIds: new Set() };
      window.__manePixels.activeId = id;
      dlog('active pixel set (from object) →', id, 'via', k);
      return;
    }
  }

  dlog('no pixel match for unit object/str', unit);
}

// ===== Eventos =====
export type ReservationEvent = {
  reservationCode?: string | null;
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  unit?: string | null; // pode ser slug ou nome, depende do seu payload
  area?: string | null;
  status?: string | null;
  source?: string | null;
};

function norm(v?: string | null) {
  return (v || '').trim();
}

/**
 * Dispara evento no pixel "ativo" (trackSingle) e, se não houver ativo, cai pro trackCustom.
 * Também injeta unit_slug "normalizado" no payload para aparecer no Events Manager.
 */
function fbqTrackCustomActive(singleEventName: string, payload: any) {
  const active = window.__manePixels?.activeId;

  if (!window.fbq) {
    dlog('fbq missing on track', singleEventName, payload);
    return;
  }

  if (active) {
    dlog('trackSingle', singleEventName, '→', active, payload);
    window.fbq('trackSingle', active, singleEventName, payload);
  } else {
    dlog('trackCustom (no active pixel)', singleEventName, payload);
    window.fbq('trackCustom', singleEventName, payload);
  }
}

function withUnitSlug(payload: any, unitRaw?: string | null) {
  const unit_norm = norm(unitRaw);
  return {
    ...payload,
    unit: unit_norm,
    unit_slug: unit_norm ? normalizeKey(unit_norm) : '',
  };
}

export async function trackReservationMade(ev: ReservationEvent) {
  const base = {
    reservation_code: norm(ev.reservationCode),
    full_name: norm(ev.fullName),
    email: norm(ev.email),
    phone: norm(ev.phone),
    area: norm(ev.area),
    status: norm(ev.status),
    source: norm(ev.source),
  };

  const payload = withUnitSlug(base, ev.unit);

  fbqTrackCustomActive('Reservation Made', payload);
  (window as any).dataLayer?.push({ event: 'reservation_made', ...payload });
}

export async function trackReservationCheckin(ev: ReservationEvent) {
  const base = {
    reservation_code: norm(ev.reservationCode),
    full_name: norm(ev.fullName),
    email: norm(ev.email),
    phone: norm(ev.phone),
    area: norm(ev.area),
    status: norm(ev.status),
    source: norm(ev.source),
  };

  const payload = withUnitSlug(base, ev.unit);

  fbqTrackCustomActive('Reservation Checkin', payload);
  (window as any).dataLayer?.push({ event: 'reservation_checkin', ...payload });
}
