import type {
  Attachment,
  CacheHint,
  ChunkElement,
  MaterialElement,
  MessageElement,
  ToolCall,
  ToolResultKind,
} from '@modular-prompt/core';

/** 資料の最小入力。`id` 省略時は `title` を使用する。 */
export interface MaterialInput {
  title: string;
  content: string | Attachment[];
  id?: string;
  usage?: number;
}

/** 標準メッセージの最小入力。 */
export interface StandardMessageInput {
  role: 'system' | 'assistant' | 'user';
  content: string | Attachment[];
  name?: string;
  toolCalls?: ToolCall[];
}

/** ツール結果メッセージの最小入力。 */
export interface ToolResultMessageInput {
  role: 'tool';
  toolCallId: string;
  name: string;
  kind: ToolResultKind;
  value: unknown;
}

export type MessageInput = StandardMessageInput | ToolResultMessageInput;

/** 補強情報（chunk）の最小入力。`partOf` 省略時は `inputs`。 */
export interface ChunkInput {
  content: string | Attachment[];
  partOf?: string;
  index?: number;
  total?: number;
  usage?: number;
}

/** 文字列は `content` の省略記法。 */
export type ChunkInputValue = string | ChunkInput;

export type MaterialsInput = MaterialInput | readonly MaterialInput[];
export type MessagesInput = MessageInput | readonly MessageInput[];
export type InputsInput = ChunkInputValue | readonly ChunkInputValue[];

function toInputArray<T>(value: T | readonly T[]): readonly T[] {
  return (Array.isArray(value) ? value : [value]) as readonly T[];
}

function withCacheHint<T extends { cacheHint?: CacheHint }>(
  element: T,
  defaultHint: CacheHint,
): T {
  return {
    ...element,
    cacheHint: defaultHint,
  };
}

export function normalizeMaterial(
  input: MaterialInput,
  _index: number,
): MaterialElement {
  const element: MaterialElement = {
    type: 'material',
    id: input.id ?? input.title,
    title: input.title,
    content: input.content,
    ...(input.usage !== undefined ? { usage: input.usage } : {}),
  };
  return withCacheHint(element, 'immutable');
}

export function normalizeMessage(input: MessageInput): MessageElement {
  if (input.role === 'tool') {
    const element: MessageElement = {
      type: 'message',
      role: 'tool',
      toolCallId: input.toolCallId,
      name: input.name,
      kind: input.kind,
      value: input.value,
    };
    return withCacheHint(element, 'contextual');
  }

  const element: MessageElement = {
    type: 'message',
    role: input.role,
    content: input.content,
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.toolCalls !== undefined ? { toolCalls: input.toolCalls } : {}),
  };
  return withCacheHint(element, 'immutable');
}

export function normalizeChunkInput(
  input: ChunkInputValue,
  _index: number,
): ChunkElement {
  const chunk = typeof input === 'string'
    ? { content: input }
    : input;

  const element: ChunkElement = {
    type: 'chunk',
    partOf: chunk.partOf ?? 'inputs',
    content: chunk.content,
    ...(chunk.index !== undefined ? { index: chunk.index } : {}),
    ...(chunk.total !== undefined ? { total: chunk.total } : {}),
    ...(chunk.usage !== undefined ? { usage: chunk.usage } : {}),
  };
  return withCacheHint(element, 'contextual');
}

export function normalizeMaterials(
  materials?: MaterialsInput,
): readonly MaterialElement[] | undefined {
  if (materials === undefined) {
    return undefined;
  }
  return toInputArray(materials).map((input, index) => normalizeMaterial(input, index));
}

export function normalizeMessages(
  messages?: MessagesInput,
): readonly MessageElement[] | undefined {
  if (messages === undefined) {
    return undefined;
  }
  return toInputArray(messages).map((input) => normalizeMessage(input));
}

export function normalizeInputs(
  inputs?: InputsInput,
): readonly ChunkElement[] | undefined {
  if (inputs === undefined) {
    return undefined;
  }
  return toInputArray(inputs).map((input, index) => normalizeChunkInput(input, index));
}

/** 補強情報の単一 chunk 入力ヘルパー。 */
export function inputChunk(
  content: ChunkInput['content'],
  options?: Pick<ChunkInput, 'partOf' | 'index' | 'total' | 'usage'>,
): ChunkInput {
  return {
    content,
    partOf: options?.partOf ?? 'inputs',
    ...(options?.index !== undefined ? { index: options.index } : {}),
    ...(options?.total !== undefined ? { total: options.total } : {}),
    ...(options?.usage !== undefined ? { usage: options.usage } : {}),
  };
}

/** JSON オブジェクトを chunk 入力に変換するヘルパー。 */
export function inputChunksFromJson(
  data: unknown,
  partOf = 'inputs',
): ChunkInput[] {
  return [inputChunk(JSON.stringify(data, null, 2), { partOf })];
}
