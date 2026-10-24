/**
 * Cloudflare Pages Function: /api/progress
 * Syncs spelling bee progress and voice/app preferences with Cloudflare KV.
 *
 * Expected KV Binding name in Cloudflare Pages Settings -> Functions -> KV namespace bindings:
 *   PROGRESS_KV (also checks RED_SQUIGGLY_KV or KV as fallbacks)
 */

const KV_KEY = 'progress:default';

function getKvBinding(env) {
  return env?.PROGRESS_KV || env?.RED_SQUIGGLY_KV || env?.KV || null;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  });
}

function mergeProgressMaps(serverProgress = {}, clientProgress = {}) {
  const merged = { ...serverProgress };

  for (const [wordKey, clientEntry] of Object.entries(clientProgress)) {
    if (!clientEntry || typeof clientEntry !== 'object') continue;
    const serverEntry = merged[wordKey];

    if (!serverEntry) {
      merged[wordKey] = { ...clientEntry };
      continue;
    }

    const clientTime = Number(clientEntry.lastPracticed || 0);
    const serverTime = Number(serverEntry.lastPracticed || 0);
    const clientTotal = Number(clientEntry.correct || 0) + Number(clientEntry.incorrect || 0);
    const serverTotal = Number(serverEntry.correct || 0) + Number(serverEntry.incorrect || 0);

    // Prefer whichever record has more practice attempts or a newer timestamp
    if (clientTotal > serverTotal || (clientTotal === serverTotal && clientTime >= serverTime)) {
      merged[wordKey] = {
        ...serverEntry,
        ...clientEntry,
        bookmarked:
          clientTime >= serverTime
            ? Boolean(clientEntry.bookmarked)
            : Boolean(serverEntry.bookmarked),
      };
    } else {
      merged[wordKey] = {
        ...clientEntry,
        ...serverEntry,
        bookmarked:
          serverTime > clientTime
            ? Boolean(serverEntry.bookmarked)
            : Boolean(clientEntry.bookmarked),
      };
    }
  }

  return merged;
}

export async function onRequestGet(context) {
  const kv = getKvBinding(context.env);
  if (!kv) {
    return jsonResponse({
      ok: true,
      kvConfigured: false,
      progress: {},
      settings: {},
      updatedAt: null,
    });
  }

  try {
    const stored = await kv.get(KV_KEY, { type: 'json' });
    return jsonResponse({
      ok: true,
      kvConfigured: true,
      progress: stored?.progress || {},
      settings: stored?.settings || {},
      updatedAt: stored?.updatedAt || null,
    });
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        kvConfigured: true,
        error: err?.message || 'Failed to read from Cloudflare KV',
      },
      500
    );
  }
}

export async function onRequestPut(context) {
  const kv = getKvBinding(context.env);
  if (!kv) {
    return jsonResponse({
      ok: true,
      kvConfigured: false,
      message: 'KV binding not configured; saved in browser storage only.',
    });
  }

  try {
    const incoming = await context.request.json();
    const shouldMerge = incoming?.merge !== false;

    let finalProgress = incoming?.progress || {};
    let finalSettings = incoming?.settings || {};

    if (shouldMerge) {
      const existing = (await kv.get(KV_KEY, { type: 'json' })) || {};
      finalProgress = mergeProgressMaps(existing.progress || {}, finalProgress);
      finalSettings = { ...(existing.settings || {}), ...finalSettings };
    }

    const payload = {
      progress: finalProgress,
      settings: finalSettings,
      updatedAt: Date.now(),
    };

    await kv.put(KV_KEY, JSON.stringify(payload));

    return jsonResponse({
      ok: true,
      kvConfigured: true,
      ...payload,
    });
  } catch (err) {
    return jsonResponse(
      {
        ok: false,
        kvConfigured: true,
        error: err?.message || 'Failed to write to Cloudflare KV',
      },
      500
    );
  }
}

export async function onRequestPost(context) {
  return onRequestPut(context);
}

export async function onRequestDelete(context) {
  const kv = getKvBinding(context.env);
  if (!kv) {
    return jsonResponse({ ok: true, kvConfigured: false });
  }

  try {
    await kv.delete(KV_KEY);
    return jsonResponse({ ok: true, kvConfigured: true, progress: {}, updatedAt: Date.now() });
  } catch (err) {
    return jsonResponse({ ok: false, error: err?.message || 'Failed to delete KV key' }, 500);
  }
}
