import type {
  Element,
  TextElement,
  MessageElement,
  MaterialElement,
  ChunkElement,
  SectionElement,
  SubSectionElement,
  JSONElement
} from '@modular-prompt/core';
import type { ElementFormatter, FormatterOptions, SpecialToken, SpecialTokenPair } from './types.js';

/**
 * Default formatter implementation for converting elements to text
 */
export class DefaultFormatter implements ElementFormatter {
  private options: Required<Omit<FormatterOptions, 'preamble' | 'sectionDescriptions' | 'formatter' | 'specialTokens'>> & 
    Pick<FormatterOptions, 'preamble' | 'sectionDescriptions' | 'specialTokens'>;
  private specialTokens?: Record<string, SpecialToken | SpecialTokenPair>;
  
  constructor(options: FormatterOptions = {}) {
    this.options = {
      preamble: options.preamble,
      sectionDescriptions: options.sectionDescriptions,
      markers: {
        sectionStart: options.markers?.sectionStart || '',
        sectionEnd: options.markers?.sectionEnd || '',
        subsectionStart: options.markers?.subsectionStart || '',
        subsectionEnd: options.markers?.subsectionEnd || '',
        materialStart: options.markers?.materialStart || '<material>',
        materialEnd: options.markers?.materialEnd || '</material>',
        chunkStart: options.markers?.chunkStart || '<chunk>',
        chunkEnd: options.markers?.chunkEnd || '</chunk>',
        messageRole: options.markers?.messageRole || '',
        messageContent: options.markers?.messageContent || '',
        ...options.markers
      },
      indent: {
        size: options.indent?.size || 2,
        char: options.indent?.char || ' ',
        ...options.indent
      },
      lineBreak: options.lineBreak || '\n',
      specialTokens: options.specialTokens
    };
    this.specialTokens = options.specialTokens;
  }
  
  format(element: Element): string {
    switch (element.type) {
      case 'text':
        return this.formatText(element);
      case 'message':
        return this.formatMessage(element);
      case 'material':
        return this.formatMaterial(element);
      case 'chunk':
        return this.formatChunk(element);
      case 'section':
        return this.formatSection(element);
      case 'subsection':
        return this.formatSubSection(element);
      case 'json':
        return this.formatJSONElement(element);
      default: {
        // Type guard exhaustive check
        const _exhaustive: never = element;
        throw new Error(`Unknown element type: ${(_exhaustive as unknown as { type: string }).type}`);
      }
    }
  }
  
  formatAll(elements: Element[]): string {
    const { lineBreak } = this.options;
    return elements.map(el => this.format(el)).join(lineBreak + lineBreak);
  }
  
  setSpecialTokens(tokens: Record<string, SpecialToken | SpecialTokenPair>): void {
    this.specialTokens = tokens;
    this.options.specialTokens = tokens;
    // Update markers if special tokens are provided
    if (tokens) {
      this.updateMarkersFromSpecialTokens(tokens);
    }
  }
  
  private updateMarkersFromSpecialTokens(tokens: Record<string, SpecialToken | SpecialTokenPair>): void {
    // Auto-configure markers based on special tokens if available
    const markers = this.options.markers;

    // Update section markers if tokens are available
    if (tokens.system && this.isTokenPair(tokens.system)) {
      markers.sectionStart = markers.sectionStart || tokens.system.start.text;
      markers.sectionEnd = markers.sectionEnd || tokens.system.end.text;
    }

    // Update thinking/reasoning markers for subsections
    if (tokens.thinking && this.isTokenPair(tokens.thinking)) {
      markers.subsectionStart = markers.subsectionStart || tokens.thinking.start.text;
      markers.subsectionEnd = markers.subsectionEnd || tokens.thinking.end.text;
    }

    // Note: Material formatting now uses special tokens directly in formatMaterial()
    // with priority: quote > ref > citation > context
  }
  
  private isTokenPair(token: SpecialToken | SpecialTokenPair): token is SpecialTokenPair {
    return 'start' in token && 'end' in token;
  }
  
  private formatText(element: TextElement): string {
    return element.content;
  }
  
  private formatMessage(element: MessageElement): string {
    const { markers } = this.options;
    const role = element.role.toUpperCase();

    // Convert content to string based on message type
    let contentStr: string;
    if (element.role === 'tool') {
      // ToolResultMessageElement
      switch (element.kind) {
        case 'text':
          contentStr = String(element.value);
          break;
        case 'data':
          contentStr = JSON.stringify(element.value);
          break;
        case 'error':
          contentStr = String(element.value);
          break;
        default:
          contentStr = String(element.value);
      }
    } else {
      // StandardMessageElement
      contentStr = typeof element.content === 'string'
        ? element.content
        : JSON.stringify(element.content);
    }

    // Use special tokens or custom markers if available
    if (this.specialTokens && this.specialTokens[element.role]) {
      const token = this.specialTokens[element.role];
      if (this.isTokenPair(token)) {
        return `${token.start.text}${contentStr}${token.end.text}`;
      }
    }

    // Use role-specific markers if configured
    if (markers.messageRole && markers.messageContent) {
      const roleMarker = markers.messageRole.replace('{role}', role);
      const contentMarker = markers.messageContent.replace('{content}', contentStr);
      return roleMarker + contentMarker;
    }

    // Default formatting with XML-like tags for MLX models
    return `<!-- begin of ${role} -->\n${contentStr.trim()}\n<!-- end of ${role} -->`;
  }
  
  private formatMaterial(element: MaterialElement): string {
    const { lineBreak } = this.options;

    // Handle content which can be string or Attachment[]
    const contentStr = typeof element.content === 'string'
      ? element.content
      : JSON.stringify(element.content);

    // Try to use special tokens with priority: quote > ref > citation > context
    if (this.specialTokens) {
      const quoteToken = this.getSpecialToken('quote');
      if (quoteToken) {
        return `${quoteToken.start}${element.title}${lineBreak}${contentStr}${quoteToken.end}${lineBreak}`;
      }

      const refToken = this.getSpecialToken('ref');
      if (refToken) {
        return `${refToken.start}${element.title}${lineBreak}${contentStr}${refToken.end}${lineBreak}`;
      }

      const citationToken = this.getSpecialToken('citation');
      if (citationToken) {
        return `${citationToken.start}${element.title}${lineBreak}${contentStr}${citationToken.end}${lineBreak}`;
      }

      const contextToken = this.getSpecialToken('context');
      if (contextToken) {
        return `${contextToken.start}Material: ${element.title}${lineBreak}${contentStr}${contextToken.end}${lineBreak}`;
      }
    }

    // Default: markdown quote format
    const lines = contentStr.split(lineBreak);
    const quotedContent = lines.map((line: string) => `> ${line}`).join(lineBreak);
    return `### ${element.title}${lineBreak}${lineBreak}${quotedContent}${lineBreak}`;
  }

  private getSpecialToken(tokenName: string): { start: string; end: string } | null {
    if (!this.specialTokens) return null;

    const token = this.specialTokens[tokenName];
    if (token && this.isTokenPair(token)) {
      return {
        start: token.start.text || '',
        end: token.end.text || ''
      };
    }

    return null;
  }
  
  private formatChunk(element: ChunkElement): string {
    const { markers, lineBreak } = this.options;
    const lines: string[] = [];
    
    // Handle content which can be string or Attachment[]
    const contentStr = typeof element.content === 'string' 
      ? element.content 
      : JSON.stringify(element.content);
    
    // Add custom markers if provided
    if (markers.chunkStart) lines.push(markers.chunkStart);
    
    // Format chunk title based on available information
    let chunkTitle: string;
    if (element.index !== undefined && element.total !== undefined) {
      chunkTitle = `#### Chunk ${element.index}/${element.total} of ${element.partOf}`;
    } else if (element.index !== undefined) {
      chunkTitle = `#### Chunk ${element.index} of ${element.partOf}`;
    } else {
      chunkTitle = `#### Part of ${element.partOf}`;
    }
    
    lines.push(chunkTitle);
    lines.push('');
    lines.push(contentStr);
    
    if (markers.chunkEnd) lines.push(markers.chunkEnd);
    
    return lines.join(lineBreak);
  }
  
  private formatSection(element: SectionElement): string {
    const { lineBreak } = this.options;
    const lines: string[] = [];

    lines.push(`## ${element.title}`);
    lines.push('');

    // Track previous item type for spacing
    let previousItemType: 'string' | 'subsection' | null = null;

    // Format items without automatic bullet points
    for (const item of element.items) {
      if (typeof item === 'string') {
        // Add blank line if previous was subsection
        if (previousItemType === 'subsection') {
          lines.push('');
        }
        lines.push(item);
        previousItemType = 'string';
      } else if (typeof item === 'function') {
        // Skip DynamicContent functions - they should be resolved before formatting
        continue;
      } else {
        // Subsection element
        // Add blank line if there was any previous item
        if (previousItemType !== null) {
          lines.push('');
        }
        const formatted = this.format(item);
        lines.push(formatted);
        previousItemType = 'subsection';
      }
    }

    return lines.join(lineBreak);
  }
  
  private formatJSONElement(element: JSONElement): string {
    const { lineBreak } = this.options;
    const lines: string[] = [];

    const jsonContent = typeof element.content === 'string'
      ? element.content
      : JSON.stringify(element.content, null, 2);

    lines.push('### JSON Output Format');
    lines.push('');
    lines.push('```json');
    lines.push(jsonContent);
    lines.push('```');

    return lines.join(lineBreak);
  }

  private formatSubSection(element: SubSectionElement): string {
    const { markers, lineBreak } = this.options;
    const lines: string[] = [];

    // Add subsection start marker if provided
    if (markers.subsectionStart) lines.push(markers.subsectionStart);

    lines.push(`### ${element.title}`);
    lines.push('');

    // Format items without automatic bullet points
    for (const item of element.items) {
      if (typeof item === 'string') {
        lines.push(item);
      }
      // SimpleDynamicContent functions should be resolved before formatting
    }

    // Add subsection end marker if provided
    if (markers.subsectionEnd) lines.push(markers.subsectionEnd);

    return lines.join(lineBreak);
  }
}