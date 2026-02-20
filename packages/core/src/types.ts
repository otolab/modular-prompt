// 基本型定義

// Attachment定義
export interface Attachment {
  type: 'text' | 'image_url' | 'file';
  text?: string;
  image_url?: { url: string };
  file?: { path: string; mime_type: string };
}

// テキスト要素
export interface TextElement {
  type: 'text';
  content: string;
}

// 標準メッセージ要素
export interface StandardMessageElement {
  type: 'message';
  role: 'system' | 'assistant' | 'user';
  content: string | Attachment[];
  name?: string;
  /** tool call付きassistantメッセージ用 */
  toolCalls?: ToolCall[];
}

// ツール実行結果の種類
export type ToolResultKind = 'text' | 'data' | 'error';

// ツール結果メッセージ要素
export interface ToolResultMessageElement {
  type: 'message';
  role: 'tool';
  /** 対応するToolCallのID */
  toolCallId: string;
  /** 関数名 */
  name: string;
  /** 値の種類を示すタグ */
  kind: ToolResultKind;
  /** ツール実行結果の値そのもの */
  value: unknown;
}

// メッセージ要素（Union型）
export type MessageElement = StandardMessageElement | ToolResultMessageElement;

// 資料要素
export interface MaterialElement {
  type: 'material';
  content: string | Attachment[];
  id: string;
  title: string;
  usage?: number;
}

// 分割テキスト要素
export interface ChunkElement {
  type: 'chunk';
  content: string | Attachment[];
  partOf: string;
  index?: number;
  total?: number;  // Total number of chunks
  usage?: number;
}

// セクション要素（第1階層）
export interface SectionElement<TContext = any> {
  type: 'section';
  category: SectionType;  // 配置先の大セクション（instructions/data/output）
  title: string;
  items: (string | SubSectionElement<TContext> | DynamicContent<TContext>)[];
}

// サブセクション要素（第2階層）
// 入れ子の複雑な構造を許さないように、サブセクションは構造化されないテキストのみを出力できる
export interface SubSectionElement<TContext = any> {
  type: 'subsection';
  title: string;
  items: (string | SimpleDynamicContent<TContext>)[];
}

// ツール呼び出し（モデル → アプリ）
export interface ToolCall {
  /** ツール呼び出しの一意ID */
  id: string;
  /** 関数名 */
  name: string;
  /** 引数データ（ネイティブオブジェクト） */
  arguments: Record<string, unknown>;
  /** ドライバー固有のコンテキスト（次ターンへのパススルー用） */
  metadata?: Record<string, unknown>;
}

// JSON スキーマ要素
export interface JSONElement {
  type: 'json';
  content: object | string;  // JSONSchemaオブジェクトまたはJSON文字列
}

// 統合型
export type Element<TContext = any> =
  | TextElement
  | MessageElement
  | MaterialElement
  | ChunkElement
  | SectionElement<TContext>
  | SubSectionElement<TContext>
  | JSONElement;

// 動的に生成できる要素（構造要素は除外）
export type DynamicElement =
  | TextElement
  | MessageElement
  | MaterialElement
  | ChunkElement
  | JSONElement;

// シンプルな動的コンテンツ（文字列のみを生成）
// SubSection内で使用される
export type SimpleDynamicContent<TContext = any> = 
  (context: TContext) => 
    | string                    // 単純な文字列
    | string[]                  // 文字列配列
    | null                     // 何も返さない
    | undefined;               // 何も返さない

// コンテキストに基づいて動的に要素を生成
// 利便性のため、文字列や文字列配列も直接返せるようにする
export type DynamicContent<TContext = any> = 
  (context: TContext) => 
    | string                    // 単純な文字列
    | string[]                  // 文字列配列（簡潔な記述のため）
    | DynamicElement           // 単一の要素
    | DynamicElement[]         // 要素の配列
    | null                     // 何も返さない
    | undefined;               // 何も返さない

// セクションコンテンツ型
// Element型全体を含むことで、静的な要素配置を可能にする
export type SectionContent<TContext = any> =
  (string | Element | DynamicContent<TContext>)[];

// プロンプトモジュール
export interface PromptModule<TContext = any> {
  // コンテキストの生成
  createContext?: () => TContext;
  
  // Instructions セクション
  objective?: SectionContent<TContext>;
  terms?: SectionContent<TContext>;
  methodology?: SectionContent<TContext>;
  instructions?: SectionContent<TContext>;
  guidelines?: SectionContent<TContext>;
  preparationNote?: SectionContent<TContext>;
  
  // Data セクション
  state?: SectionContent<TContext>;
  inputs?: SectionContent<TContext>;
  materials?: SectionContent<TContext>;
  chunks?: SectionContent<TContext>;
  messages?: SectionContent<TContext>;
  
  // Output セクション
  cue?: SectionContent<TContext>;
  schema?: SectionContent<TContext>;
  
  // 追加のセクション（明示的にSectionElementを配置）
  sections?: SectionElement<TContext>[];
}

// 標準セクション定義
export const STANDARD_SECTIONS = {
  // Instructions
  objective: { type: 'instructions' as const, title: 'Objective and Role' },
  terms: { type: 'instructions' as const, title: 'Term Explanations' },
  methodology: { type: 'instructions' as const, title: 'Processing Methodology' },
  instructions: { type: 'instructions' as const, title: 'Instructions' },
  guidelines: { type: 'instructions' as const, title: 'Guidelines' },
  preparationNote: { type: 'instructions' as const, title: 'Response Preparation Note' },
  
  // Data
  state: { type: 'data' as const, title: 'Current State' },
  inputs: { type: 'data' as const, title: 'Input Data' },
  materials: { type: 'data' as const, title: 'Prepared Materials' },
  chunks: { type: 'data' as const, title: 'Input Chunks' },
  messages: { type: 'data' as const, title: 'Messages' },
  
  // Output
  cue: { type: 'output' as const, title: 'Output' },
  schema: { type: 'output' as const, title: 'Output Schema' }
} as const;

// セクション名の型
export type StandardSectionName = keyof typeof STANDARD_SECTIONS;

// セクションタイプの型
export type SectionType = 'instructions' | 'data' | 'output';

// コンパイル済みプロンプト
export interface CompiledPrompt {
  instructions: Element[];
  data: Element[];
  output: Element[];
  metadata?: {
    outputSchema?: object;  // JSONElementから抽出されたスキーマ
  };
}