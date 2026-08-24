import type { DynamicContent } from '@modular-prompt/core';
import type { ExtractContext } from './extract-context.js';
import {
  expandCueContent,
  sectionHasContent,
  sectionTemplateHeader,
} from './extract-context.js';

const materialsTemplate: DynamicContent<ExtractContext> = (ctx) => {
  if (!sectionHasContent(ctx.materials)) {
    return null;
  }
  return [
    sectionTemplateHeader('以下の Prepared Materials を読み取り、出力指示の観点に沿って情報を抽出する。'),
    ...ctx.materials,
  ];
};

const messagesTemplate: DynamicContent<ExtractContext> = (ctx) => {
  if (!sectionHasContent(ctx.messages)) {
    return null;
  }
  return [
    sectionTemplateHeader('以下の Messages（対話ログ）を読み取り、発言者・内容・前後関係を区別して抽出する。'),
    ...ctx.messages,
  ];
};

const inputsTemplate: DynamicContent<ExtractContext> = (ctx) => {
  if (!sectionHasContent(ctx.inputs)) {
    return null;
  }
  return [
    sectionTemplateHeader('以下の Input Data（補強情報）を参照する。資料の代替ではなく、出力指示と併せて利用する。'),
    ...ctx.inputs,
  ];
};

const cueTemplate: DynamicContent<ExtractContext> = (ctx) => {
  return [
    sectionTemplateHeader('以下の出力指示に従い、抽出結果のみを回答する。'),
    ...expandCueContent(ctx.cue),
  ];
};

export const extractSectionTemplates = {
  materials: materialsTemplate,
  messages: messagesTemplate,
  inputs: inputsTemplate,
  cue: cueTemplate,
} as const;
