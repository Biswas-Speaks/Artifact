/**
 * server/ai/providers.js
 * Provider verification, model listing, and code generation.
 *
 * Supported providers: "gemini" (Google Generative Language API) and "openai".
 *
 * Provider documentation consulted:
 *  - Gemini: https://ai.google.dev/api/models (as of 2025)
 *    List models: GET https://generativelanguage.googleapis.com/v1beta/models
 *    Generate:    POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 *    Structured output via "responseMimeType":"application/json" + "responseSchema"
 *  - OpenAI: https://platform.openai.com/docs/api-reference/models (as of 2025)
 *    List models: GET https://api.openai.com/v1/models
 *    Generate:    POST https://api.openai.com/v1/chat/completions
 *    Structured output via response_format: { type: "json_schema", json_schema: {...} }
 *
 * Security:
 *  - Only two fixed base URLs; no user-supplied URLs (prevents SSRF).
 *  - API key goes ONLY into the HTTP Authorization/x-goog-api-key header.
 *  - Key is never logged, never included in returned errors.
 *  - Provider error payloads are mapped to friendly messages; raw bodies are not forwarded.
 */

'use strict';

// ── Fixed provider endpoints (no user input allowed) ───────────────────────
const ENDPOINTS = Object.freeze({
  gemini: {
    models:   'https://generativelanguage.googleapis.com/v1beta/models',
    generate: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
  },
  openai: {
    models:   'https://api.openai.com/v1/models',
    generate: 'https://api.openai.com/v1/chat/completions',
  },
});

// ── Timeout ────────────────────────────────────────────────────────────────
const VERIFY_TIMEOUT_MS    = 20_000;
const GENERATION_TIMEOUT_MS = 60_000;

// ── Model filter lists ─────────────────────────────────────────────────────
// Only include text generation models. We exclude embedding, image, audio,
// moderation, and fine-tuned preview models that don't support chat.
const GEMINI_MODEL_EXCLUDE_RE = /embedding|vision|aqa|imagen|learnlm|gecko|tts|image|transcribe|lyria|robotics|deep.research|antigravity|computer.use|nano.banana|banana|omni|customtools/i;
const OPENAI_MODEL_EXCLUDE_RE = /embedding|whisper|dall-e|tts|moderation|babbage|davinci|instruct|codex|audio|image|realtime|transcribe|search|live|diarize|translate/i;

// Preferred defaults (used when available)
const GEMINI_DEFAULT  = 'gemini-3.8-flash';
const OPENAI_DEFAULT  = 'gpt-4o';

/**
 * Map a provider HTTP status + response to a friendly error message.
 * Never returns the raw provider payload.
 *
 * @param {string}  provider 'gemini' | 'openai'
 * @param {number}  status   HTTP status code
 * @param {string}  phase    'verify' | 'generate'
 * @returns {string}
 */
function friendlyError(provider, status, phase) {
  if (status === 401 || status === 403) {
    return `${provider === 'gemini' ? 'Google Gemini' : 'OpenAI'} rejected the API key — it may be invalid, revoked, or missing required permissions.`;
  }
  if (status === 429) {
    return `${provider === 'gemini' ? 'Google Gemini' : 'OpenAI'} rate limit or quota exceeded. Wait a moment and try again.`;
  }
  if (status === 404 && phase === 'generate') {
    return 'The selected model was not found. Please update your model in AI Settings.';
  }
  if (status >= 500) {
    return `${provider === 'gemini' ? 'Google Gemini' : 'OpenAI'} is temporarily unavailable (server error ${status}). Try again shortly.`;
  }
  return `Unexpected response from the AI provider (HTTP ${status}).`;
}

/**
 * Build fetch options (headers) for a given provider + key.
 * The key appears ONLY in the header.
 *
 * @param {string} provider
 * @param {string} key
 * @returns {Record<string, string>}
 */
function authHeaders(provider, key) {
  if (provider === 'gemini') return { 'x-goog-api-key': key };
  return { Authorization: `Bearer ${key}` };
}

// ── JSON output schema for structured output ───────────────────────────────
const OUTPUT_SCHEMA = {
  type: 'object',
  required: ['note', 'files'],
  properties: {
    note:  { type: 'string' },
    files: {
      type: 'array',
      items: {
        type: 'object',
        required: ['path', 'action'],
        properties: {
          path:    { type: 'string' },
          action:  { type: 'string', enum: ['create', 'replace', 'edit', 'delete'] },
          content: { type: 'string' },
          edits: {
            type: 'array',
            items: {
              type: 'object',
              required: ['find', 'replace'],
              properties: {
                find:    { type: 'string' },
                replace: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  additionalProperties: false,
};

// ── Helper: fetch with AbortController timeout ─────────────────────────────
async function fetchWithTimeout(url, opts, timeoutMs) {
  const ac = opts.signal ? null : new AbortController();
  const signal = opts.signal ?? ac.signal;
  const timer  = ac ? setTimeout(() => ac.abort(), timeoutMs) : null;
  try {
    return await fetch(url, { ...opts, signal });
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ══════════════════════════════════════════════════════════════════════════
//  VERIFY KEY + FETCH MODEL LIST
// ══════════════════════════════════════════════════════════════════════════

/**
 * Verify an API key and return the list of usable text-generation model IDs.
 * Does NOT store anything.
 *
 * @param {string} provider  'gemini' | 'openai'
 * @param {string} key       Raw API key
 * @returns {Promise<{ ok: true, models: string[], default: string } | { ok: false, error: string }>}
 */
async function verifyKey(provider, key) {
  if (!ENDPOINTS[provider]) {
    return { ok: false, error: 'Unknown provider. Choose "gemini" or "openai".' };
  }

  let resp;
  try {
    resp = await fetchWithTimeout(
      ENDPOINTS[provider].models,
      {
        method:  'GET',
        headers: { 'Content-Type': 'application/json', ...authHeaders(provider, key) },
      },
      VERIFY_TIMEOUT_MS
    );
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: 'Connection timed out while verifying the key.' };
    return { ok: false, error: 'Could not connect to the AI provider. Check your internet connection.' };
  }

  if (!resp.ok) {
    return { ok: false, error: friendlyError(provider, resp.status, 'verify') };
  }

  let body;
  try { body = await resp.json(); } catch {
    return { ok: false, error: 'Unexpected response format from the AI provider.' };
  }

  const models = extractModelIds(provider, body);
  if (models.length === 0) {
    return { ok: false, error: 'No usable text-generation models found for this key.' };
  }

  return {
    ok:      true,
    models,
    default: preferredDefault(provider, models),
  };
}

/**
 * Extract and filter text-generation model IDs from a provider's model list response.
 */
function extractModelIds(provider, body) {
  if (provider === 'gemini') {
    const list = Array.isArray(body.models) ? body.models : [];
    return list
      .filter(m => {
        const name = String(m.name || '');
        // Only keep generateContent-capable models
        const supportedMethods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods : [];
        const supportsGenerate = supportedMethods.includes('generateContent');
        const excluded = GEMINI_MODEL_EXCLUDE_RE.test(name);
        return supportsGenerate && !excluded;
      })
      .map(m => String(m.name).replace(/^models\//, '')); // strip "models/" prefix
  }

  if (provider === 'openai') {
    const list = Array.isArray(body.data) ? body.data : [];
    return list
      .filter(m => {
        const id = String(m.id || '');
        return !OPENAI_MODEL_EXCLUDE_RE.test(id) && (
          /^gpt-[3456]/.test(id) || /^gpt-4/.test(id) || /^gpt-5/.test(id) || /^gpt-6/.test(id) ||
          /^o[1234]/.test(id) || id === 'gpt-4o' || id === 'gpt-4o-mini'
        );
      })
      .map(m => m.id)
      .sort((a, b) => {
        // Sort newest/best first — higher version numbers first, prefer non-dated variants
        const score = (id) => {
          if (/^gpt-6/.test(id)) return 70;
          if (/^gpt-5\.[5-9]/.test(id)) return 65;
          if (/^gpt-5\.[3-4]/.test(id)) return 60;
          if (/^gpt-5\.[12]/.test(id)) return 55;
          if (/^gpt-5\./.test(id)) return 50;
          if (/^gpt-5/.test(id)) return 48;
          if (/^gpt-4\.1/.test(id)) return 45;
          if (id === 'gpt-4o' || id.startsWith('gpt-4o-2')) return 40;
          if (id.startsWith('gpt-4o')) return 38;
          if (/^o[34]/.test(id)) return 35;
          if (/^o1/.test(id)) return 30;
          if (/^gpt-4/.test(id)) return 20;
          return 5;
        };
        const sd = score(b) - score(a);
        if (sd !== 0) return sd;
        // For same score, prefer non-dated (shorter) ids
        return a.length - b.length;
      });
  }

  return [];
}

function preferredDefault(provider, models) {
  const pref = provider === 'gemini' ? GEMINI_DEFAULT : OPENAI_DEFAULT;
  return models.includes(pref) ? pref : models[0];
}

// ══════════════════════════════════════════════════════════════════════════
//  GENERATE CODE
// ══════════════════════════════════════════════════════════════════════════

/**
 * Send a generation request to the provider.
 *
 * @param {object} opts
 * @param {string}   opts.provider
 * @param {string}   opts.model
 * @param {string}   opts.apiKey       Plain-text API key (decrypted server-side)
 * @param {string}   opts.systemPrompt
 * @param {string}   opts.contextText  Artifact content + recent chat
 * @param {string}   opts.userPrompt
 * @param {AbortSignal} [opts.signal]  AbortController signal for timeout/cancel
 * @returns {Promise<{ ok: true, raw: string } | { ok: false, error: string, invalidKey?: boolean }>}
 */
async function generate({ provider, model, apiKey, systemPrompt, contextText, userPrompt, signal }) {
  if (!ENDPOINTS[provider]) {
    return { ok: false, error: 'Unknown provider.' };
  }

  let resp;
  try {
    if (provider === 'gemini') {
      resp = await callGemini({ model, apiKey, systemPrompt, contextText, userPrompt, signal });
    } else {
      resp = await callOpenAI({ model, apiKey, systemPrompt, contextText, userPrompt, signal });
    }
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, error: 'The generation request timed out or was cancelled.' };
    return { ok: false, error: 'Could not connect to the AI provider.' };
  }

  if (!resp.response.ok) {
    const isInvalidKey = resp.response.status === 401 || resp.response.status === 403;
    return {
      ok: false,
      error: friendlyError(provider, resp.response.status, 'generate'),
      invalidKey: isInvalidKey,
    };
  }

  let body;
  try { body = await resp.response.json(); } catch {
    return { ok: false, error: 'Unexpected response format from the AI provider.' };
  }

  const raw = extractGeneratedText(provider, body);
  if (!raw) {
    return { ok: false, error: 'The AI provider returned an empty response.' };
  }

  return { ok: true, raw };
}

// ── Gemini call ─────────────────────────────────────────────────────────────

async function callGemini({ model, apiKey, systemPrompt, contextText, userPrompt, signal }) {
  const url = ENDPOINTS.gemini.generate.replace('{model}', encodeURIComponent(model));

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents: [
      {
        role: 'user',
        parts: [{ text: `${contextText}\n\nUSER REQUEST:\n${userPrompt}` }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema:   OUTPUT_SCHEMA,
      temperature:      0.4,
      maxOutputTokens:  8192,
    },
  };

  const response = await fetchWithTimeout(
    url,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders('gemini', apiKey) },
      body:    JSON.stringify(body),
      signal,
    },
    GENERATION_TIMEOUT_MS
  );

  return { response };
}

function extractGeneratedText(provider, body) {
  if (provider === 'gemini') {
    try {
      return body.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
    } catch { return null; }
  }
  if (provider === 'openai') {
    try {
      return body.choices?.[0]?.message?.content ?? null;
    } catch { return null; }
  }
  return null;
}

// ── OpenAI call ─────────────────────────────────────────────────────────────

async function callOpenAI({ model, apiKey, systemPrompt, contextText, userPrompt, signal }) {
  // o1/o3/o4 series do not support system role or response_format JSON schema
  const isReasoningModel = /^o[134]/.test(model);

  let messages;
  let responseFormat;

  if (isReasoningModel) {
    // Reasoning models: merge system + context + user into one user message
    messages = [
      {
        role: 'user',
        content: `${systemPrompt}\n\n${contextText}\n\nUSER REQUEST:\n${userPrompt}\n\nRespond with ONLY valid JSON matching the output schema in the system instructions.`,
      },
    ];
  } else {
    messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: `${contextText}\n\nUSER REQUEST:\n${userPrompt}` },
    ];
    responseFormat = {
      type: 'json_schema',
      json_schema: {
        name:   'biswa_ai_output',
        strict: true,
        schema: OUTPUT_SCHEMA,
      },
    };
  }

  const requestBody = {
    model,
    messages,
    temperature: isReasoningModel ? undefined : 0.4,
    max_completion_tokens: 8192,
    ...(responseFormat ? { response_format: responseFormat } : {}),
  };

  // Remove undefined keys
  Object.keys(requestBody).forEach(k => requestBody[k] === undefined && delete requestBody[k]);

  const response = await fetchWithTimeout(
    ENDPOINTS.openai.generate,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders('openai', apiKey) },
      body:    JSON.stringify(requestBody),
      signal,
    },
    GENERATION_TIMEOUT_MS
  );

  return { response };
}

module.exports = { verifyKey, generate, extractModelIds, preferredDefault };
