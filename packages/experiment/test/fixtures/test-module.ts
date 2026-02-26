/**
 * Test module for experiment
 */

import type { PromptModule } from '@modular-prompt/core';

const module: PromptModule<{ input?: string }> = {
  objective: ['Test objective'],
  instructions: ['Test instruction'],
  inputs: [
    (ctx) => ctx.input || 'default input',
  ],
};

export default module;
