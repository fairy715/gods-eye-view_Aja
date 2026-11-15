import { t } from '../i18n/index.js';
import { createTextChat } from './textChat.js';

/**
 * Claude as an AI provider: typed chat only. Claude has no voice session, so
 * the microphone is refused with a line that says where voice is, and Chat
 * works as it does for the other providers.
 */
export function createClaudeSession(options) {
  const chat = createTextChat({ ...options, provider: 'claude' });
  let active = false;
  return {
    capabilities: {
      costControls: false,
      pushToTalk: false,
      advisoryLimit: t(
        'Claude answers typed chat only. For voice, choose OpenAI or Gemini.',
      ),
    },
    start(settings) {
      // The session reports a failed start with this line.
      if (!settings?.textOnly)
        throw new Error(
          t(
            'Claude answers typed chat only. For voice, choose OpenAI or Gemini.',
          ),
        );
      active = true;
      return chat.start();
    },
    // Chat is the only mode there is.
    getStartOptions: () => ({
      pushToTalk: false,
      ...(active ? { textOnly: true } : {}),
    }),
    stop(settings) {
      active = false;
      chat.stop(settings);
    },
    cancelTurn: () => active && chat.cancelTurn(),
    sendText: (text) => active && chat.sendText(text),
    sendMapEvent: (event) => active && chat.sendMapEvent(event),
  };
}
