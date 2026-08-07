export const MODULAR_PROMPT_DIR: string;
export const RUNTIME_PROFILES: string[];

export function getModularPromptHome(): string;
export function getRuntimesRoot(): string;
export function getRuntimeDir(profile: string): string;
export function getVenvPath(profile: string): string;
export function getManifestPath(profile: string): string;
export function getMlxPythonDir(packageRoot: string): string;
export function isRuntimeReady(profile: string): boolean;
