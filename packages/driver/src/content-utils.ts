import type { Attachment } from '@modular-prompt/core';

export interface ThinkingExtractResult {
  content: string;
  thinkingContent?: string;
}

/**
 * Extract <think>...</think> blocks from model output.
 * Returns cleaned content and extracted thinking content.
 */
export function extractThinkingContent(text: string): ThinkingExtractResult {
  const thinkingParts: string[] = [];

  // 1. <think>...</think> blocks
  const fullBlockRegex = /<think>([\s\S]*?)<\/think>\s*/g;
  let match;
  while ((match = fullBlockRegex.exec(text)) !== null) {
    const inner = match[1].trim();
    if (inner) thinkingParts.push(inner);
  }
  let cleaned = text.replace(fullBlockRegex, '');

  // 1b. Stream truncation: ...content</think> (missing opening tag)
  const headRegex = /^[\s\S]*?<\/think>\s*/;
  const headMatch = cleaned.match(headRegex);
  if (headMatch) {
    const inner = headMatch[0].replace(/<\/think>\s*$/, '').trim();
    if (inner) thinkingParts.push(inner);
    cleaned = cleaned.replace(headRegex, '');
  }

  // 2. <|channel>thought...<channel|> blocks (Gemma-4)
  const gemma4Regex = /<\|channel>thought([\s\S]*?)<channel\|>\s*/g;
  let gemma4Match;
  while ((gemma4Match = gemma4Regex.exec(cleaned)) !== null) {
    const inner = gemma4Match[1].trim();
    if (inner) thinkingParts.push(inner);
  }
  cleaned = cleaned.replace(gemma4Regex, '');

  // 2b. Stream truncation: ...content<channel|> (missing opening tag)
  const gemma4HeadRegex = /^[\s\S]*?<channel\|>\s*/;
  const gemma4HeadMatch = cleaned.match(gemma4HeadRegex);
  if (gemma4HeadMatch) {
    const inner = gemma4HeadMatch[0].replace(/<channel\|>\s*$/, '').trim();
    if (inner) thinkingParts.push(inner);
    cleaned = cleaned.replace(gemma4HeadRegex, '');
  }

  return {
    content: cleaned.trim(),
    thinkingContent: thinkingParts.length > 0 ? thinkingParts.join('\n') : undefined,
  };
}

/**
 * Extract text content from string or Attachment array.
 * For Attachment arrays, only text-type attachments are included.
 */
export function contentToString(content: string | Attachment[]): string {
  if (typeof content === 'string') return content;
  return content
    .filter((att): att is Attachment & { text: string } => att.type === 'text' && att.text != null)
    .map(att => att.text)
    .join('\n');
}

/**
 * Extract image URLs/paths from Attachment array.
 * Returns empty array for string content.
 */
export function extractImagePaths(content: string | Attachment[]): string[] {
  if (typeof content === 'string') return [];
  return content
    .filter((att): att is Attachment & { image_url: { url: string } } =>
      att.type === 'image_url' && att.image_url?.url != null
    )
    .map(att => att.image_url.url);
}
