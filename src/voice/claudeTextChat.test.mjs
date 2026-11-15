// Claude in typed chat: the Messages API wire format the browser keeps, and
// the session that offers chat but no voice.
//
// Run with: npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { textProtocols } from './textProtocol.js';
import { createClaudeSession } from './claudeSession.js';
import { VOICE_PROVIDERS } from './providerCapabilities.js';

const claude = textProtocols.claude;
const REPLY = {
  content: {
    role: 'assistant',
    content: [
      { type: 'thinking', thinking: '', signature: 'sig' },
      { type: 'text', text: 'Looking ' },
      { type: 'text', text: 'now.' },
      { type: 'tool_use', id: 'toolu_1', name: 'fly_to', input: { lat: 1 } },
      { type: 'tool_use', id: 'toolu_2', name: 'set_layer', input: {} },
    ],
  },
  finishReason: 'tool_use',
};

test('a reply is read for its text and calls, and kept whole', () => {
  const decoded = claude.decode(REPLY);
  assert.equal(decoded.content, REPLY.content, 'echoed back unchanged');
  assert.equal(decoded.text, 'Looking now.');
  assert.deepEqual(decoded.calls, [
    { id: 'toolu_1', name: 'fly_to', args: { lat: 1 } },
    { id: 'toolu_2', name: 'set_layer', args: {} },
  ]);
  assert.equal(decoded.finished, false);
  for (const finishReason of ['end_turn', 'refusal'])
    assert.equal(claude.decode({ ...REPLY, finishReason }).finished, true);
  assert.equal(
    claude.decode({ ...REPLY, finishReason: 'max_tokens' }).finished,
    false,
  );
  for (const bad of [
    {},
    { content: { role: 'user', content: [] } },
    { content: { role: 'assistant', content: [] } },
    { content: { role: 'assistant', content: 'text' } },
  ])
    assert.throws(() => claude.decode(bad), /Invalid response/);
});

test("one round's results go back in a single user message", () => {
  const { calls } = claude.decode(REPLY);
  const results = claude.results([
    { call: calls[0], result: { ok: true } },
    { call: calls[1], result: { ok: false, error: 'no' } },
  ]);
  assert.deepEqual(results, [
    {
      role: 'user',
      content: [
        { type: 'tool_result', tool_use_id: 'toolu_1', content: '{"ok":true}' },
        {
          type: 'tool_result',
          tool_use_id: 'toolu_2',
          content: '{"ok":false,"error":"no"}',
        },
      ],
    },
  ]);
  // Tool results are not where a user turn starts; typed text is.
  assert.equal(claude.isUser(results[0]), false);
  assert.equal(claude.isUser(claude.user('hello')), true);
  assert.equal(claude.isUser(claude.note('stopped')), false);
  assert.deepEqual(claude.request([claude.user('hi')]), {
    messages: [{ role: 'user', content: 'hi' }],
  });
});

test('earlier turns are never rewritten', () => {
  const big = claude.results([
    { call: { id: 't' }, result: { ok: true, rows: 'x'.repeat(5000) } },
  ])[0];
  assert.equal(claude.compactResult(big, 1500), big);
  assert.equal(claude.keyEnv, 'ANTHROPIC_API_KEY');
  assert.equal(claude.endpoint, '/api/claude/chat');
});

test('the session offers chat and refuses voice with a reason', () => {
  const events = [];
  const session = createClaudeSession({
    emit: (event) => events.push(event),
    runAction: async () => ({ ok: true }),
  });
  assert.equal(VOICE_PROVIDERS.claude.label, 'Claude');
  assert.equal(session.capabilities.pushToTalk, false);
  assert.throws(() => session.start({ pushToTalk: false }), /typed chat only/);
  assert.equal(session.sendText('hi'), false, 'nothing is sent before chat');
  assert.deepEqual(session.getStartOptions(), { pushToTalk: false });
  session.start({ textOnly: true });
  assert.deepEqual(session.getStartOptions(), {
    pushToTalk: false,
    textOnly: true,
  });
  assert.ok(events.some((event) => event.state === 'listening'));
  session.stop();
  assert.deepEqual(session.getStartOptions(), { pushToTalk: false });
});
