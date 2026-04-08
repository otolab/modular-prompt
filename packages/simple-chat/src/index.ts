/**
 * Simple Chat - Moduler Prompt chat application
 */

export { runChat } from './chat.js';
export {
  loadDefaultProfile,
  loadDialogProfile
} from './profile.js';
export {
  createChatLog,
  loadChatLog,
  saveChatLog,
  addMessage,
  getChatLogStats,
} from './chat-log.js';
export {
  buildChatModule,
  createDriver,
  performAIChat,
  closeDriver,
} from './ai-chat.js';
export type { ChatContext } from './ai-chat.js';
export { loadResourceFiles } from './resource-files.js';
export type {
  DialogProfile,
  ChatLog,
  ChatLogEntry,
  SimpleChatOptions,
} from './types.js';
