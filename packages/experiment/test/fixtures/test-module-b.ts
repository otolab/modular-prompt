/**
 * Test module B for format command tests
 */

import type { PromptModule } from '@modular-prompt/core';

const module: PromptModule<{ input?: string }> = {
  objective: ['Second test objective'],
  instructions: ['Second test instruction'],
};

export default module;
