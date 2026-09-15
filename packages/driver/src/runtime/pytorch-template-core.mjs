import { cpSync, existsSync, mkdirSync, readdirSync } from 'fs';
import { dirname, join } from 'path';

const PRESERVED_RUNTIME_FILES = new Set(['pyproject.toml', 'uv.lock']);

function copyTemplateContents(templateDir, runtimePythonDir) {
  mkdirSync(runtimePythonDir, { recursive: true });
  for (const entry of readdirSync(templateDir)) {
    if (PRESERVED_RUNTIME_FILES.has(entry)) {
      continue;
    }
    cpSync(join(templateDir, entry), join(runtimePythonDir, entry), {
      recursive: true,
      force: true,
    });
  }
}

function assertTemplateExists(templateDir) {
  if (!existsSync(templateDir)) {
    throw new Error(`PyTorch template not found: ${templateDir}`);
  }
}

/**
 * 初回 setup 用に template 一式を runtime へ seed する。
 * 既存 runtime の pyproject.toml / uv.lock はユーザー管理として保持する。
 */
export function seedPytorchTemplate(templateDir, runtimePythonDir) {
  assertTemplateExists(templateDir);
  if (!existsSync(runtimePythonDir)) {
    mkdirSync(dirname(runtimePythonDir), { recursive: true });
    cpSync(templateDir, runtimePythonDir, { recursive: true });
    return;
  }

  copyTemplateContents(templateDir, runtimePythonDir);
  for (const file of PRESERVED_RUNTIME_FILES) {
    const templateFile = join(templateDir, file);
    const runtimeFile = join(runtimePythonDir, file);
    if (!existsSync(runtimeFile) && existsSync(templateFile)) {
      cpSync(templateFile, runtimeFile, { force: true });
    }
  }
}

/**
 * 既存 runtime のコードを template から同期する。
 * pyproject.toml と uv.lock は上書きしない。
 */
export function syncPytorchTemplate(templateDir, runtimePythonDir) {
  assertTemplateExists(templateDir);
  copyTemplateContents(templateDir, runtimePythonDir);
}
