/**
 * Shared compile and format utilities for experiment runner and format CLI
 */

import { compile, type CompiledPrompt } from '@modular-prompt/core';
import { formatCompletionPrompt, formatPromptAsMessages } from '@modular-prompt/driver';
import type { ModuleDefinition, TestCase } from './types.js';

export type PromptFormatType = 'completion' | 'messages' | 'compiled';

export interface FormattedPromptItem {
  testCaseName: string;
  testCaseDescription?: string;
  moduleName: string;
  compiled: CompiledPrompt;
}

/**
 * Compile a prompt module with test case input
 */
export function compileModulePrompt(
  module: ModuleDefinition['module'],
  input: unknown
): CompiledPrompt {
  return compile(module, input);
}

/**
 * Format a compiled prompt to the requested output type
 */
export function formatCompiledPrompt(
  compiled: CompiledPrompt,
  formatType: PromptFormatType
): string {
  switch (formatType) {
    case 'completion':
      return formatCompletionPrompt(compiled);
    case 'messages':
      return JSON.stringify(formatPromptAsMessages(compiled), null, 2);
    case 'compiled':
      return JSON.stringify(compiled, null, 2);
  }
}

/**
 * Build format plan: expand testCase × module combinations (no model dimension)
 */
export function buildFormatPlan(
  modules: ModuleDefinition[],
  testCases: TestCase[]
): FormattedPromptItem[] {
  const items: FormattedPromptItem[] = [];

  for (const testCase of testCases) {
    const modulesToFormat = testCase.modules
      ? modules.filter(m => testCase.modules!.includes(m.name))
      : modules;

    for (const module of modulesToFormat) {
      items.push({
        testCaseName: testCase.name,
        testCaseDescription: testCase.description,
        moduleName: module.name,
        compiled: compileModulePrompt(module.module, testCase.input),
      });
    }
  }

  return items;
}

/**
 * Render formatted output for all plan items
 */
export function renderFormattedOutput(
  items: FormattedPromptItem[],
  formatType: PromptFormatType
): string {
  if (items.length === 0) {
    return '';
  }

  if (formatType === 'completion') {
    return items.map(item => {
      const header = `=== ${item.moduleName} / ${item.testCaseName} ===`;
      const body = formatCompletionPrompt(item.compiled);
      return `${header}\n${body}`;
    }).join('\n\n');
  }

  if (formatType === 'messages') {
    return JSON.stringify(
      items.map(item => ({
        testCase: item.testCaseName,
        module: item.moduleName,
        messages: formatPromptAsMessages(item.compiled),
      })),
      null,
      2
    );
  }

  return JSON.stringify(
    items.map(item => ({
      testCase: item.testCaseName,
      module: item.moduleName,
      compiled: item.compiled,
    })),
    null,
    2
  );
}
