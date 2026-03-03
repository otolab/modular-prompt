/**
 * Chat log management
 */

import { readFile, writeFile } from 'fs/promises';
import type { ChatLog, ChatLogEntry, DialogProfile } from './types.js';

/**
 * Create new chat log
 */
export function createChatLog(profile: DialogProfile): ChatLog {
  return {
    sessionId: generateSessionId(),
    startedAt: new Date().toISOString(),
    profile,
    messages: [],
  };
}

/**
 * Load chat log from file
 */
export async function loadChatLog(logPath: string): Promise<ChatLog> {
  try {
    const content = await readFile(logPath, 'utf-8');
    return JSON.parse(content) as ChatLog;
  } catch (error) {
    throw new Error(`Failed to load chat log from ${logPath}: ${error}`);
  }
}

/**
 * Save chat log to file
 */
export async function saveChatLog(chatLog: ChatLog, logPath: string): Promise<void> {
  try {
    const content = JSON.stringify(chatLog, null, 2);
    await writeFile(logPath, content, 'utf-8');
  } catch (error) {
    throw new Error(`Failed to save chat log to ${logPath}: ${error}`);
  }
}

/**
 * Add message to chat log
 */
export function addMessage(
  chatLog: ChatLog,
  role: 'system' | 'user' | 'assistant',
  content: string,
  resourceFiles?: string[],
  images?: string[]
): void {
  const entry: ChatLogEntry = {
    role,
    content,
    timestamp: new Date().toISOString(),
  };

  if (resourceFiles && resourceFiles.length > 0) {
    entry.resourceFiles = resourceFiles;
  }

  if (images && images.length > 0) {
    entry.images = images;
  }

  chatLog.messages.push(entry);
}

/**
 * Get chat log statistics
 */
export function getChatLogStats(chatLog: ChatLog) {
  const userMessages = chatLog.messages.filter(m => m.role === 'user').length;
  const assistantMessages = chatLog.messages.filter(m => m.role === 'assistant').length;
  const systemMessages = chatLog.messages.filter(m => m.role === 'system').length;
  
  return {
    totalMessages: chatLog.messages.length,
    userMessages,
    assistantMessages,
    systemMessages,
    sessionId: chatLog.sessionId,
    startedAt: chatLog.startedAt,
  };
}

/**
 * Generate session ID
 */
function generateSessionId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 9);
  return `${timestamp}-${random}`;
}