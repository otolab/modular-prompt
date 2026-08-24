/**
 * Dialog profile management using PromptModule
 */

import { readFile } from 'fs/promises';
import yaml from 'js-yaml';
import type { DialogProfile } from './types.js';
import { validateProfileOptions } from './utils/profile-validator.js';

/**
 * Create the default profile used when no profile file is specified.
 *
 * Keep model selection out of this profile so the user's models.yaml can
 * provide the default model before ai-chat's built-in fallback is used.
 */
function createDefaultProfile(): DialogProfile {
  return {
    module: {
      objective: [
        'チャットアシスタントとして、最新のユーザメッセージに対する返答メッセージを作成する',
      ],
      instructions: [
        '日本語の対話として自然になるように務めます',
        'コンテキストの理解を重視してください',
      ],
    },
    options: {
      temperature: 1.0,
      maxTokens: 4000,
      topP: 0.95,
    },
  };
}

/**
 * Load the default profile without reading a package file.
 */
export async function loadDefaultProfile(): Promise<DialogProfile> {
  return createDefaultProfile();
}

/**
 * Load dialog profile from file
 */
export async function loadDialogProfile(profilePath: string): Promise<DialogProfile> {
  try {
    const content = await readFile(profilePath, 'utf-8');
    const profile = yaml.load(content) as DialogProfile;

    // Validate that options use camelCase, not snake_case
    validateProfileOptions(profile);

    return profile;
  } catch (error) {
    if (error instanceof Error && error.message.includes('snake_case')) {
      // Re-throw validation errors as-is
      throw error;
    }
    throw new Error(`Failed to load dialog profile from ${profilePath}: ${error}`);
  }
}
