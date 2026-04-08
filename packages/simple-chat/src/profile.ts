/**
 * Dialog profile management using PromptModule
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import type { DialogProfile } from './types.js';
import { validateProfileOptions } from './utils/profile-validator.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to the default profile bundled with the package */
const DEFAULT_PROFILE_PATH = join(__dirname, '../default-profile.yaml');

/**
 * Load default profile
 */
export async function loadDefaultProfile(): Promise<DialogProfile> {
  return loadDialogProfile(DEFAULT_PROFILE_PATH);
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
