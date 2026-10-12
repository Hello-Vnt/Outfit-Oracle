// OutfitOracle AI proxy — one endpoint, POST /style.
// Holds the Anthropic API key as a Worker secret so it never reaches the browser.
import Anthropic from '@anthropic-ai/sdk';

const OCCASIONS = ['work', 'date', 'brunch', 'party', 'travel', 'campus'];
const WEATHERS = ['hot', 'rainy', 'mild', 'cool'];
const STYLES = ['minimal', 'romantic', 'street', 'vintage', 'sporty'];
const TYPES = ['top', 'bottom', 'shoes', 'accessory'];

const MAX_BODY_BYTES = 16_000;
const MAX_CATALOG_ITEMS = 60;
const RATE_LIMIT = 20; // requests per IP per window
const RATE_WINDOW_MS = 60 * 60 * 1000;

const SYSTEM = `You are the Oracle, a warm, sharp fashion stylist. You style one complete look from a fixed wardrobe.
Pick exactly four items: one top, one bottom, one pair of shoes, one accessory, in that order. Use only ids from the wardrobe list.
Respect the weather first (nothing impractical), then the style, then the occasion. Make the four pieces work together in colour.
Write the note as one short paragraph (2 to 3 sentences, under 60 words) speaking to the wearer, saying why the look works and one way to wear it.`;

const OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    items: { type: 'array', items: { type: 'integer' }, description: 'Four wardrobe ids: top, bottom, shoes, accessory' },
    note: { type: 'string', description: 'One short styling paragraph' },
  },
  required: ['items', 'note'],
  additionalProperties: false,
};

// Per-isolate fallback counter, used when no KV namespace is bound as RATE_KV.
const memoryHits = new Map();

async function overLimit(env, ip) {
  const bucket = Math.floor(Date.now() / RATE_WINDOW_MS);
  const key = `rl:${ip}:${bucket}`;
  if (env.RATE_KV) {
    const count = Number(await env.RATE_KV.get(key)) || 0;
    if (count >= RATE_LIMIT) return true;
    await env.RATE_KV.put(key, String(count + 1), { expirationTtl: 2 * 60 * 60 });
    return false;
  }
  for (const k of memoryHits.keys()) if (!k.endsWith(`:${bucket}`)) memoryHits.delete(k);
  const count = memoryHits.get(key) || 0;
  if (count >= RATE_LIMIT) return true;
  memoryHits.set(key, count + 1);
  return false;
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : null;
}

function json(body, status, origin) {
  const headers = { 'Content-Type': 'application/json', Vary: 'Origin' };
  if (origin) headers['Access-Control-Allow-Origin'] = origin;
  return new Response(JSON.stringify(body), { status, headers });
}

// Tags and names come from the browser, so keep only what a wardrobe line needs.
const clean = (value, max) => String(value ?? '').replace(/[^\p{L}\p{N} &'-]/gu, '').trim().slice(0, max);
const cleanTags = (value) => (Array.isArray(value) ? value.slice(0, 6).map((t) => clean(t, 16).toLowerCase()).filter(Boolean) : []);

function parseRequest(body) {
  const occasion = String(body?.occasion).toLowerCase();
  const weather = String(body?.weather).toLowerCase();
  const style = String(body?.style).toLowerCase();
  if (!OCCASIONS.includes(occasion) || !WEATHERS.includes(weather) || !STYLES.includes(style)) return null;
  if (!Array.isArray(body.catalog) || body.catalog.length < 4 || body.catalog.length > MAX_CATALOG_ITEMS) return null;

  const catalog = new Map();
  for (const raw of body.catalog) {
    const id = Number(raw?.id);
    if (!Number.isInteger(id) || id < 1 || id > 65535 || !TYPES.includes(raw.type)) return null;
    catalog.set(id, {
      id,
      type: raw.type,
      name: clean(raw.name, 40),
      colour: clean(raw.colour, 24),
      styles: cleanTags(raw.styles),
      weather: cleanTags(raw.weather),
    });
  }
  if (TYPES.some((type) => ![...catalog.values()].some((item) => item.type === type))) return null;

  const avoid = Array.isArray(body.avoid) ? body.avoid.slice(0, 8).map(Number).filter((id) => catalog.has(id)) : [];
  return { occasion, weather, style, catalog, avoid };
}

function buildPrompt({ occasion, weather, style, catalog, avoid }) {
  const lines = [...catalog.values()].map(
    (i) => `${i.id} | ${i.type} | ${i.name} | ${i.colour} | ${i.styles.join(' ')} | ${i.weather.join(' ')}`,
  );
  return [
    `Occasion: ${occasion}`,
    `Weather: ${weather}`,
    `Style: ${style}`,
    avoid.length ? `They just saw items ${avoid.join(', ')}; choose different pieces where you can.` : '',
    '',
    'Wardrobe (id | type | name | colour | styles | weather):',
    ...lines,
  ]
    .filter((line, i) => line || i === 4)
    .join('\n');
}

function validLook(result, catalog) {
  if (!result || !Array.isArray(result.items) || result.items.length !== 4) return false;
  if (typeof result.note !== 'string' || !result.note.trim()) return false;
  return TYPES.every((type, i) => catalog.get(result.items[i])?.type === type);
}

async function styleLook(request, env, origin) {
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (await overLimit(env, ip)) return json({ error: 'rate_limited' }, 429, origin);

  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: 'too_large' }, 413, origin);
  let look;
  try {
    look = parseRequest(JSON.parse(text));
  } catch {
    look = null;
  }
  if (!look) return json({ error: 'bad_request' }, 400, origin);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'not_configured' }, 500, origin);

  // The site falls back to its rule-based picker after 8s, so fail fast rather than retry.
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 0, timeout: 7500 });
  try {
    const response = await client.messages.create({
      model: env.MODEL || 'claude-opus-5-5',
      max_tokens: 1024,
      system: SYSTEM,
      messages: [{ role: 'user', content: buildPrompt(look) }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    });
    if (response.stop_reason !== 'end_turn') return json({ error: 'no_look', reason: response.stop_reason }, 502, origin);

    const block = response.content.find((b) => b.type === 'text');
    const result = JSON.parse(block?.text ?? 'null');
    if (!validLook(result, look.catalog)) return json({ error: 'invalid_look' }, 502, origin);
    return json({ items: result.items, note: result.note.trim().slice(0, 600) }, 200, origin);
  } catch (error) {
    if (error instanceof Anthropic.RateLimitError) return json({ error: 'upstream_busy' }, 503, origin);
    if (error instanceof Anthropic.APIConnectionTimeoutError) return json({ error: 'upstream_timeout' }, 504, origin);
    if (error instanceof Anthropic.APIError) {
      console.error('anthropic error', error.status, error.message);
      return json({ error: 'upstream_error' }, 502, origin);
    }
    console.error('style error', error);
    return json({ error: 'upstream_error' }, 502, origin);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = allowedOrigin(request, env);

    if (url.pathname !== '/style') return json({ error: 'not_found' }, 404, origin);
    if (request.method === 'OPTIONS') {
      if (!origin) return new Response(null, { status: 403 });
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Methods': 'POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type',
          'Access-Control-Max-Age': '86400',
          Vary: 'Origin',
        },
      });
    }
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405, origin);
    if (!origin) return json({ error: 'origin_not_allowed' }, 403, null);
    return styleLook(request, env, origin);
  },
};
