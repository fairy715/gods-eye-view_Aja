import { createClaudeChatHandler } from './claude/chat.js';

/** Typed chat answered by Claude; the API key stays on this server. */
function claudeChatProxy({ annotationGuidance, realtime = {} } = {}) {
  function install(middlewares) {
    middlewares.use(
      '/api/claude/chat',
      createClaudeChatHandler({ ...realtime, annotationGuidance }),
    );
  }
  return {
    name: 'claude-chat-proxy',
    configureServer(server) {
      install(server.middlewares);
    },
    configurePreviewServer(server) {
      install(server.middlewares);
    },
  };
}

export { claudeChatProxy };
