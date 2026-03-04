import type { Attachment } from '@modular-prompt/core';

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
