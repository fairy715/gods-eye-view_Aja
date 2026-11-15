import { validateValue } from '../../../src/tools/schema.js';

export function invalidCalls(calls, tools) {
  const schemas = new Map(tools.map((tool) => [tool.name, tool.parameters]));
  return calls.flatMap((call, index) => {
    const schema = schemas.get(call.name);
    const errors = !schema
      ? ['Unknown tool']
      : call.parseError
        ? ['Arguments must be valid JSON']
        : validateValue(schema, call.args === undefined ? {} : call.args);
    return errors.length
      ? [{ index, error: errors.slice(0, 4).join('; ').slice(0, 1000) }]
      : [];
  });
}

// Missing usage stays unknown, never an invented zero-cost request.
export function parseUsage(provider, data) {
  if (provider === 'claude') return parseClaudeUsage(data?.usage);
  const raw = provider === 'gemini' ? data?.usageMetadata : data?.usage;
  const number = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  const inputTokens = number(
    provider === 'gemini' ? raw?.promptTokenCount : raw?.prompt_tokens,
  );
  const candidateTokens = number(
    provider === 'gemini' ? raw?.candidatesTokenCount : raw?.completion_tokens,
  );
  const totalTokens = number(
    provider === 'gemini' ? raw?.totalTokenCount : raw?.total_tokens,
  );
  if (inputTokens === null || candidateTokens === null || totalTokens === null)
    return null;
  const reasoningTokens =
    number(
      provider === 'gemini'
        ? raw?.thoughtsTokenCount
        : raw?.completion_tokens_details?.reasoning_tokens,
    ) ?? 0;
  const outputTokens =
    candidateTokens + (provider === 'gemini' ? reasoningTokens : 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    reasoningTokens,
    cachedInputTokens:
      number(
        provider === 'gemini'
          ? raw?.cachedContentTokenCount
          : raw?.prompt_tokens_details?.cached_tokens,
      ) ?? 0,
  };
}

// The Messages API counts cached input apart from the rest; the total a
// reader expects is all three, with the cache reads named on their own.
function parseClaudeUsage(raw) {
  const number = (value) =>
    Number.isSafeInteger(value) && value >= 0 ? value : null;
  const uncached = number(raw?.input_tokens);
  const outputTokens = number(raw?.output_tokens);
  if (uncached === null || outputTokens === null) return null;
  const cachedInputTokens = number(raw?.cache_read_input_tokens) ?? 0;
  const inputTokens =
    uncached +
    cachedInputTokens +
    (number(raw?.cache_creation_input_tokens) ?? 0);
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    reasoningTokens: 0,
    cachedInputTokens,
  };
}
