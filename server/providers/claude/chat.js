import Anthropic from '@anthropic-ai/sdk';
import { createTextChatHandler } from '../common/textChat.js';
import { invalidCalls } from '../common/textTools.js';
import { textInstructions } from '../common/textInstructions.js';
import { chatSchema } from '../openai/chat.js';
import { GEV_REALTIME_TOOLS, offeredTools } from '../openai/tools.js';
import { resolveOverpassUpstreams } from '../overpass/constants.js';

/** Chat requests a minute before the route throttles, as for the others. */
export const CLAUDE_DEFAULT_PER_MIN = 30;
export const CLAUDE_DEFAULT_MODEL = 'claude-opus-5-5';
/** What the shared handler names as the upstream; the SDK makes the call. */
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
/**
 * Two opt-ins sent with every request unless `ANTHROPIC_CHAT_BETAS=off`:
 * a declined request is re-run on the model Anthropic recommends for it, and
 * a thinking block whose earlier history this app trimmed is dropped instead
 * of failing the request.
 */
const BETAS = Object.freeze([
  'server-side-fallback-2026-07-01',
  'thinking-binding-controls-2026-08-01',
]);
const DECLINED = 'The model declined this request.';

const object = (value) =>
  value && typeof value === 'object' && !Array.isArray(value);
const keys = (value, allowed) =>
  Object.keys(value).every((key) => allowed.includes(key));
const text = (value, max) => typeof value === 'string' && value.length <= max;

/** What the browser may send as a user turn: typed text, or tool results. */
function userContent(content) {
  if (typeof content === 'string') return content.length > 0;
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.length <= 32 &&
    content.every(
      (block) =>
        object(block) &&
        ((block.type === 'text' &&
          keys(block, ['type', 'text']) &&
          text(block.text, 64_000)) ||
          (block.type === 'tool_result' &&
            keys(block, ['type', 'tool_use_id', 'content', 'is_error']) &&
            text(block.tool_use_id, 256) &&
            typeof block.content === 'string' &&
            (block.is_error === undefined ||
              typeof block.is_error === 'boolean'))),
    )
  );
}

/**
 * An assistant turn is what the API returned, echoed back whole: its
 * thinking and fallback blocks are opaque and must come back unchanged, so
 * only the blocks this app reads are checked closely.
 */
function assistantContent(content) {
  return (
    Array.isArray(content) &&
    content.length > 0 &&
    content.length <= 64 &&
    content.every(
      (block) =>
        object(block) &&
        typeof block.type === 'string' &&
        /^[a-z_]{1,48}$/.test(block.type) &&
        (block.type !== 'text' || typeof block.text === 'string') &&
        (block.type !== 'tool_use' ||
          (text(block.id, 256) &&
            text(block.name, 128) &&
            object(block.input))),
    )
  );
}

/** The conversation the browser keeps, in Messages API form. */
export function validClaudeMessages(messages) {
  return (
    Array.isArray(messages) &&
    messages.length > 0 &&
    messages.length <= 96 &&
    messages[0]?.role === 'user' &&
    messages.every(
      (message) =>
        object(message) &&
        keys(message, ['role', 'content']) &&
        (message.role === 'user'
          ? userContent(message.content)
          : message.role === 'assistant' && assistantContent(message.content)),
    )
  );
}

/**
 * Carry one Messages API request through the Anthropic SDK and hand the
 * shared chat handler a `Response`, so its admission, throttling, key
 * cool-down and error mapping apply to Claude as to the other providers. An
 * API error keeps its HTTP status (the handler tells a rejected key from a
 * rate limit from an outage by it); a connection failure is thrown.
 * @param {(apiKey: string) => Anthropic} createClient
 */
export function claudeTransport(createClient) {
  return async (_endpoint, init) => {
    const client = createClient(init.headers['x-api-key']);
    try {
      const message = await client.beta.messages.create(JSON.parse(init.body), {
        signal: init.signal,
      });
      return Response.json(message);
    } catch (error) {
      if (!(error instanceof Anthropic.APIError) || !error.status) throw error;
      const retryAfter = error.headers?.get?.('retry-after');
      return Response.json(
        { error: error.error?.error ?? null },
        {
          status: error.status,
          headers: retryAfter ? { 'retry-after': retryAfter } : {},
        },
      );
    }
  };
}

/**
 * `POST /api/claude/chat`: typed chat answered by Claude through the
 * Messages API, with the app's map actions as tools. The browser keeps the
 * conversation and sends it whole; the key stays on this server.
 */
export function createClaudeChatHandler({
  annotationGuidance,
  tools = GEV_REALTIME_TOOLS,
  overpassConfigured = () => resolveOverpassUpstreams().length > 0,
  resolveApiKey = () => process.env.ANTHROPIC_API_KEY,
  resolveChatModel = () =>
    process.env.ANTHROPIC_CHAT_MODEL || CLAUDE_DEFAULT_MODEL,
  resolveEffort = () => process.env.ANTHROPIC_CHAT_EFFORT,
  resolveBetas = () => process.env.ANTHROPIC_CHAT_BETAS,
  // One retry inside the handler's own deadline; the browser shows the rest.
  createClient = (apiKey) => new Anthropic({ apiKey, maxRetries: 1 }),
  ...options
} = {}) {
  const offered = () => offeredTools(tools, { overpass: overpassConfigured() });
  return createTextChatHandler({
    ...options,
    provider: 'claude',
    resolveApiKey,
    providerPerMin: CLAUDE_DEFAULT_PER_MIN,
    fetchImpl: claudeTransport(createClient),
    prepare(input) {
      const model = String(resolveChatModel()).trim();
      if (!/^claude-[a-z0-9][a-z0-9.-]{0,79}$/.test(model))
        return { errorStatus: 503 };
      if (
        !object(input) ||
        !keys(input, ['messages']) ||
        !validClaudeMessages(input.messages)
      )
        return null;
      const effort = String(resolveEffort() || '').trim();
      const extras =
        String(resolveBetas() || '')
          .trim()
          .toLowerCase() !== 'off';
      return {
        endpoint: ENDPOINT,
        headers: (key) => ({ 'x-api-key': key }),
        body: {
          model,
          max_tokens: 16000,
          thinking: {
            type: 'adaptive',
            ...(extras
              ? { block_binding: { prefix_mismatch_behavior: 'drop_block' } }
              : {}),
          },
          ...(extras ? { betas: [...BETAS], fallbacks: 'default' } : {}),
          ...(['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)
            ? { output_config: { effort } }
            : {}),
          // Tools, system prompt and the conversation so far are one prefix.
          cache_control: { type: 'ephemeral' },
          system: textInstructions(annotationGuidance, {
            overpass: overpassConfigured(),
          }),
          tools: offered().map(({ name, description, parameters }) => ({
            name,
            description,
            input_schema: chatSchema(parameters),
          })),
          messages: input.messages,
        },
      };
    },
    parse(data) {
      if (data?.role !== 'assistant' || !Array.isArray(data.content))
        return null;
      let blocks = data.content;
      if (data.stop_reason === 'refusal') {
        // A declined turn runs no tools, and still has to say something.
        blocks = blocks.filter((block) => block?.type !== 'tool_use');
        if (!blocks.some((block) => block?.type === 'text' && block.text))
          blocks = [...blocks, { type: 'text', text: DECLINED }];
      }
      if (!assistantContent(blocks)) return null;
      const calls = blocks
        .filter((block) => block.type === 'tool_use')
        .map((block) => ({ name: block.name, args: block.input }));
      if (
        !calls.length &&
        !blocks.some((block) => block.type === 'text' && block.text)
      )
        return null;
      return {
        content: { role: 'assistant', content: blocks },
        finishReason: data.stop_reason,
        invalidCalls: invalidCalls(calls, offered()),
      };
    },
  });
}
