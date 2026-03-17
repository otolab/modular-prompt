import type {
  PromptModule,
  CompiledPrompt,
  SectionContent,
  StandardSectionName,
  SectionElement,
  SubSectionElement,
  DynamicElement,
  SectionType,
  SimpleDynamicContent,
  Element,
  JSONElement,
  ResolvedSectionContent,
  ResolvedModule
} from './types.js';
import { STANDARD_SECTIONS } from './types.js';

// ========================================================================
// resolve: DynamicContent を解決して静的な ResolvedModule を返す
// ========================================================================

/**
 * モジュール内の DynamicContent / SimpleDynamicContent をコンテキストで解決し、
 * セクション構造を維持した ResolvedModule を返す。
 *
 * 3大セクション（instructions/data/output）への分配は行わない。
 */
export function resolve<TContext = any>(
  module: PromptModule<TContext>,
  context?: TContext
): ResolvedModule {
  const actualContext = context ?? (module.createContext ? module.createContext() : {} as TContext);
  const result: Partial<Record<StandardSectionName, ResolvedSectionContent>> = {};

  for (const sectionName of Object.keys(STANDARD_SECTIONS) as StandardSectionName[]) {
    const content = module[sectionName];
    if (!content) continue;
    result[sectionName] = resolveSectionContent(content, actualContext);
  }

  const resolved = result as ResolvedModule;

  if (module.sections) {
    resolved.sections = module.sections as SectionElement[];
  }

  return resolved;
}

/**
 * SectionContent 内の DynamicContent を解決して静的な配列を返す
 */
function resolveSectionContent<TContext>(
  content: SectionContent<TContext>,
  context: TContext
): ResolvedSectionContent {
  const items: ResolvedSectionContent = [];
  const contentItems = typeof content === 'string' ? [content] : Array.isArray(content) ? content : [];

  for (const item of contentItems) {
    if (typeof item === 'function') {
      const dynamicResult = item(context);
      const resolved = processDynamicContentToElements(dynamicResult);
      for (const elem of resolved) {
        items.push(elem);
      }
    } else if (typeof item === 'string') {
      items.push(item);
    } else if (item && typeof item === 'object' && 'type' in item) {
      if (item.type === 'subsection') {
        // SubSection 内の SimpleDynamicContent を解決
        const resolvedItems: string[] = [];
        for (const subItem of item.items) {
          if (typeof subItem === 'function') {
            const result = processSimpleDynamicContent(subItem as SimpleDynamicContent<any>, context);
            resolvedItems.push(...result);
          } else if (typeof subItem === 'string') {
            resolvedItems.push(subItem);
          }
        }
        items.push({ ...item, items: resolvedItems } as SubSectionElement);
      } else {
        items.push(item as Element);
      }
    }
  }

  return items;
}

// ========================================================================
// distribute: ResolvedModule を 3大セクションに分配して CompiledPrompt を返す
// ========================================================================

/**
 * ResolvedModule の各セクションを instructions/data/output に分配し、
 * SectionElement でラップして CompiledPrompt を生成する。
 */
export function distribute(resolved: ResolvedModule): CompiledPrompt {
  const compiled: CompiledPrompt = {
    instructions: [],
    data: [],
    output: []
  };

  for (const sectionName of Object.keys(STANDARD_SECTIONS) as StandardSectionName[]) {
    let content = resolved[sectionName];
    if (!content || content.length === 0) continue;

    const sectionDef = STANDARD_SECTIONS[sectionName];

    // schema セクション: JSONElement を metadata に抽出
    if (sectionName === 'schema') {
      for (const item of content) {
        if (item && typeof item === 'object' && 'type' in item && item.type === 'json') {
          const jsonElement = item as JSONElement;
          const schema = typeof jsonElement.content === 'string'
            ? JSON.parse(jsonElement.content)
            : jsonElement.content;
          compiled.metadata = { outputSchema: schema };

          content = content.filter(el =>
            !(el && typeof el === 'object' && 'type' in el && el.type === 'json')
          );
          break;
        }
      }

      if (content.length === 0) continue;
    }

    const elements = wrapInSection(content, sectionDef.title, sectionDef.type);
    compiled[sectionDef.type].push(...elements);
  }

  return compiled;
}

/**
 * 解決済みコンテンツを SectionElement でラップして Element 配列を返す
 */
function wrapInSection(
  content: ResolvedSectionContent,
  title: string,
  category: SectionType
): Element[] {
  const elements: Element[] = [];
  const plainItems: string[] = [];
  const subsections: SubSectionElement[] = [];

  for (const item of content) {
    if (typeof item === 'string') {
      plainItems.push(item);
    } else if (item && typeof item === 'object' && 'type' in item) {
      if (item.type === 'subsection') {
        subsections.push(item as SubSectionElement);
      } else {
        // DynamicElement (message, material, text, chunk, json) を直接追加
        elements.push(item);
      }
    }
  }

  const hasContent = elements.length > 0 || plainItems.length > 0 || subsections.length > 0;

  if (hasContent) {
    const sectionElement: SectionElement = {
      type: 'section',
      category,
      title,
      items: [...plainItems, ...subsections]
    };
    elements.unshift(sectionElement);
  }

  return elements;
}

// ========================================================================
// compile: resolve + distribute の合成
// ========================================================================

/**
 * モジュールとコンテキストからプロンプトをコンパイル
 *
 * compile = distribute(resolve(module, context))
 */
export function compile<TContext = any>(
  module: PromptModule<TContext>,
  context?: TContext
): CompiledPrompt {
  return distribute(resolve(module, context));
}

// ========================================================================
// Helpers
// ========================================================================

/**
 * DynamicContentの結果をElement配列または文字列配列に変換
 * DynamicElementはそのまま保持
 */
function processDynamicContentToElements(
  result: string | string[] | DynamicElement | DynamicElement[] | null | undefined
): (string | DynamicElement)[] {
  // null/undefinedの場合は空配列
  if (result === null || result === undefined) {
    return [];
  }

  // 文字列の場合
  if (typeof result === 'string') {
    return [result];
  }

  // 配列の場合
  if (Array.isArray(result)) {
    return result.flatMap(item => {
      if (typeof item === 'string') {
        return item;  // 文字列はそのまま
      } else {
        return item;  // DynamicElementはそのまま保持
      }
    });
  }

  // 単一のElementの場合
  return [result];
}

/**
 * SimpleDynamicContentの結果を文字列配列に変換
 */
function processSimpleDynamicContent<TContext>(
  fn: SimpleDynamicContent<TContext>,
  context: TContext
): string[] {
  const result = fn(context);

  if (result === null || result === undefined) {
    return [];
  }

  if (typeof result === 'string') {
    return [result];
  }

  if (Array.isArray(result)) {
    // string[]のみを受け入れる
    return result.filter((item): item is string => typeof item === 'string');
  }

  return [];
}

/**
 * コンテキストを作成するヘルパー関数
 */
export function createContext<TContext = any>(
  module: PromptModule<TContext>
): TContext {
  if (module.createContext) {
    return module.createContext();
  }
  return {} as TContext;
}
