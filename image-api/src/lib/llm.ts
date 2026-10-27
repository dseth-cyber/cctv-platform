import { logger } from './logger.js';
import { getSettings } from '../modules/system-settings/system-settings.service.js';

/**
 * Optional phrasing layer over answers that have already been computed.
 *
 * The model is never asked to work anything out. It receives figures this system derived
 * and is asked to say them back in a sentence or two — because a model inventing a number
 * in a report that reaches management is not a cosmetic failure. Everything here is
 * best-effort: if the LLM is disabled, unconfigured, slow or wrong, callers fall back to
 * the structured answer, which is complete on its own.
 *
 * Provider-agnostic: any OpenAI-compatible /chat/completions endpoint works, which covers
 * hosted APIs and self-hosted servers (vLLM, Ollama, LM Studio) alike.
 */

export interface LlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
  timeoutMs: number;
}

export async function getLlmConfig(): Promise<LlmConfig | null> {
  const s = await getSettings(['llm_enabled', 'llm_base_url', 'llm_model', 'llm_api_key', 'llm_timeout_seconds']);
  if (s.llm_enabled !== 'true') return null;
  const baseUrl = (s.llm_base_url ?? '').trim().replace(/\/+$/, '');
  const model = (s.llm_model ?? '').trim();
  if (!baseUrl || !model) return null;
  const seconds = Number(s.llm_timeout_seconds ?? 20);
  return {
    baseUrl,
    model,
    apiKey: s.llm_api_key ?? '',
    timeoutMs: (Number.isFinite(seconds) && seconds > 0 ? seconds : 20) * 1000,
  };
}

export async function isLlmEnabled(): Promise<boolean> {
  return (await getLlmConfig()) !== null;
}

/**
 * Returns null on any problem — never throws, never blocks an answer. A missing summary
 * degrades the reply to the structured facts; a wrong one would be worse than none.
 */
export async function summarise(input: {
  question: string;
  /** The already-computed answer, as JSON. The only facts the model may use. */
  facts: unknown;
  /** BCP-47-ish language hint from the caller ('th', 'en', ...). */
  language?: string;
}): Promise<string | null> {
  const cfg = await getLlmConfig();
  if (!cfg) return null;

  const lang = input.language || 'th';
  const system = [
    'You turn already-computed factory monitoring figures into one short, plain answer.',
    'Rules you must follow:',
    '1. Use ONLY the numbers present in the provided JSON. Never calculate, estimate or invent a figure.',
    '2. If the JSON does not answer the question, say so plainly instead of guessing.',
    '3. Repeat any caveats listed under "notes" — they are not optional.',
    '4. Two or three sentences at most. No greeting, no sign-off, no markdown.',
    `5. Reply in this language: ${lang}.`,
    'Context: this system photographs ONLY defective parts, so every count is a defect count, never production volume.',
  ].join('\n');

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), cfg.timeoutMs);
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: cfg.model,
        // Low temperature: this is a restatement task, not a creative one.
        temperature: 0.2,
        max_tokens: 300,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: `Question: ${input.question}\n\nFacts (JSON):\n${JSON.stringify(input.facts)}` },
        ],
      }),
      signal: controller.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      logger.warn({ status: res.status }, 'LLM call returned non-OK — falling back to structured answer');
      return null;
    }
    const body = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
    const text = body.choices?.[0]?.message?.content?.trim();
    return text || null;
  } catch (err) {
    logger.warn({ err }, 'LLM call failed — falling back to structured answer');
    return null;
  }
}
