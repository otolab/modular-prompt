import type { Element } from '@modular-prompt/core';
import type { StandardChatMessage } from '../types.js';

/**
 * Special token definition
 */
export interface SpecialToken {
  text: string;
  id: number;
}

/**
 * Special token pair definition
 */
export interface SpecialTokenPair {
  start: SpecialToken;
  end: SpecialToken;
}

/**
 * Chat message format (formatter always produces standard messages)
 */
export type ChatMessage = StandardChatMessage;

/**
 * Formatter options for converting elements to text
 */
export interface FormatterOptions {
  /**
   * Custom formatter instance to use
   */
  formatter?: ElementFormatter;
  
  /**
   * Preamble text to be added at the beginning of the formatted prompt
   */
  preamble?: string;
  
  /**
   * Section descriptions for each major section
   */
  sectionDescriptions?: {
    instructions?: string;
    data?: string;
    output?: string;
  };
  
  /**
   * Custom block markers for different element types
   */
  markers?: {
    sectionStart?: string;
    sectionEnd?: string;
    subsectionStart?: string;
    subsectionEnd?: string;
    materialStart?: string;
    materialEnd?: string;
    chunkStart?: string;
    chunkEnd?: string;
    messageRole?: string;
    messageContent?: string;
  };
  
  /**
   * Indentation settings
   */
  indent?: {
    size?: number;
    char?: ' ' | '\t';
  };
  
  /**
   * Line break settings
   */
  lineBreak?: '\n' | '\r\n';
  
  /**
   * Model-specific special tokens
   */
  specialTokens?: Record<string, SpecialToken | SpecialTokenPair>;
}

/**
 * Element formatter interface
 */
export interface ElementFormatter {
  /**
   * Format a single element
   */
  format(element: Element): string;
  
  /**
   * Format multiple elements
   */
  formatAll(elements: Element[]): string;
  
  /**
   * Set special tokens for formatting
   */
  setSpecialTokens?(tokens: Record<string, SpecialToken | SpecialTokenPair>): void;
}