import type { CompiledPrompt } from '@modular-prompt/core';

/**
 * Check if the prompt contains MessageElement
 */
export function hasMessageElement(prompt: CompiledPrompt): boolean {
  const checkElements = (elements: unknown[]): boolean => {
    if (!elements) return false;
    return elements.some((element) => {
      const el = element as { type?: string };
      return el?.type === 'message';
    });
  };

  return (
    checkElements(prompt.instructions) ||
    checkElements(prompt.data) ||
    checkElements(prompt.output)
  );
}
