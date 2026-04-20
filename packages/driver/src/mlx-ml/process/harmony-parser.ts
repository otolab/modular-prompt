import type { ToolCall } from '../../types.js';
import type { ResponseParseResult, ResponseProcessor } from './response-processor.js';

const START_TOKEN = '<|start|>';
const END_TOKEN = '<|end|>';
const RETURN_TOKEN = '<|return|>';
const CHANNEL_TOKEN = '<|channel|>';
const MESSAGE_TOKEN = '<|message|>';
const CALL_TOKEN = '<|call|>';
const CONSTRAIN_TOKEN = '<|constrain|>';

const MESSAGE_END_TOKENS = [CALL_TOKEN, END_TOKEN, RETURN_TOKEN] as const;
const FUNCTION_ROLE_PREFIX = 'assistant to=functions.';

interface ParsedHarmonyMessage {
  role: string;
  channel: string;
  content: string;
}

export const parseHarmonyResponse: ResponseProcessor = (rawText: string): ResponseParseResult => {
  const messages = extractHarmonyMessages(rawText);
  const finalParts: string[] = [];
  const thinkingParts: string[] = [];
  const toolCalls: ToolCall[] = [];

  for (const message of messages) {
    const channelBase = getChannelBase(message.channel);

    if (message.role.startsWith('functions.') && message.role.includes(' to=assistant')) {
      continue;
    }

    if (channelBase === 'analysis') {
      if (message.content) {
        thinkingParts.push(message.content);
      }
      continue;
    }

    if (channelBase === 'final') {
      if (message.content) {
        finalParts.push(message.content);
      }
      continue;
    }

    const toolCall = parseToolCallMessage(message, toolCalls.length);
    if (toolCall) {
      toolCalls.push(toolCall);
    }
  }

  return {
    content: finalParts.join('\n'),
    thinkingContent: thinkingParts.length > 0 ? thinkingParts.join('\n') : undefined,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  };
};

function extractHarmonyMessages(rawText: string): ParsedHarmonyMessage[] {
  const messages: ParsedHarmonyMessage[] = [];
  let cursor = 0;

  while (cursor < rawText.length) {
    const startIndex = rawText.indexOf(START_TOKEN, cursor);
    if (startIndex === -1) {
      break;
    }

    const message = parseMessageAt(rawText, startIndex);
    if (!message) {
      cursor = startIndex + START_TOKEN.length;
      continue;
    }

    messages.push(message.value);
    cursor = message.nextIndex;
  }

  return messages;
}

function parseMessageAt(
  rawText: string,
  startIndex: number
): { value: ParsedHarmonyMessage; nextIndex: number } | null {
  const roleStart = startIndex + START_TOKEN.length;
  const channelIndex = rawText.indexOf(CHANNEL_TOKEN, roleStart);

  if (channelIndex === -1) {
    return null;
  }

  const messageIndex = rawText.indexOf(MESSAGE_TOKEN, channelIndex + CHANNEL_TOKEN.length);
  if (messageIndex === -1) {
    return null;
  }

  const role = rawText.slice(roleStart, channelIndex).trim();
  let channel = rawText.slice(channelIndex + CHANNEL_TOKEN.length, messageIndex);
  channel = stripTrailingConstraint(channel).trim();

  const contentStart = messageIndex + MESSAGE_TOKEN.length;
  const endInfo = findMessageEnd(rawText, contentStart);
  const contentEnd = endInfo?.index ?? rawText.length;
  const content = rawText.slice(contentStart, contentEnd).trim();

  return {
    value: {
      role,
      channel,
      content,
    },
    nextIndex: endInfo ? endInfo.index + endInfo.token.length : rawText.length,
  };
}

function stripTrailingConstraint(channel: string): string {
  const constrainIndex = channel.indexOf(CONSTRAIN_TOKEN);
  return constrainIndex === -1 ? channel : channel.slice(0, constrainIndex);
}

function findMessageEnd(
  rawText: string,
  contentStart: number
): { index: number; token: typeof CALL_TOKEN | typeof END_TOKEN | typeof RETURN_TOKEN } | null {
  let nearestIndex = -1;
  let nearestToken: typeof CALL_TOKEN | typeof END_TOKEN | typeof RETURN_TOKEN | null = null;

  for (const token of MESSAGE_END_TOKENS) {
    const index = rawText.indexOf(token, contentStart);
    if (index !== -1 && (nearestIndex === -1 || index < nearestIndex)) {
      nearestIndex = index;
      nearestToken = token;
    }
  }

  if (nearestIndex === -1 || nearestToken === null) {
    return null;
  }

  return { index: nearestIndex, token: nearestToken };
}

function parseToolCallMessage(message: ParsedHarmonyMessage, index: number): ToolCall | null {
  if (!message.role.startsWith(FUNCTION_ROLE_PREFIX)) {
    return null;
  }

  const name = message.role.slice(FUNCTION_ROLE_PREFIX.length).trim();
  if (!name) {
    return null;
  }

  const channelBase = getChannelBase(message.channel);
  if (channelBase !== 'commentary') {
    return null;
  }

  const parsedArguments = parseToolArguments(message.content);
  if (!parsedArguments) {
    return null;
  }

  return {
    id: `harmony_call_${index}`,
    name,
    arguments: parsedArguments,
  };
}

function getChannelBase(channel: string): string {
  const trimmed = channel.trim();
  const spaceIndex = trimmed.indexOf(' ');
  return spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
}

function parseToolArguments(content: string): Record<string, unknown> | null {
  if (!content) {
    return {};
  }

  try {
    const parsed = JSON.parse(content) as unknown;
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    return null;
  }

  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
