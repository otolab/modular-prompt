import { describe, it, expect } from 'vitest';
import { compile, createContext, distribute } from './compile';
import type {
  PromptModule,
  SubSectionElement,
  TextElement,
  MessageElement,
  MaterialElement,
  ChunkElement
} from './types';

describe('compile', () => {
  describe('基本的なコンパイル', () => {
    it('空のモジュールをコンパイルできる', () => {
      const module: PromptModule = {};
      const context = {};
      const result = compile(module, context);
      
      expect(result).toEqual({
        instructions: [],
        data: [],
        output: []
      });
    });

    it('標準セクションがSectionElementに変換される', () => {
      const module: PromptModule = {
        objective: ['AIアシスタントとして動作する'],
        methodology: ['データを分析', '結果を生成']
      };
      const context = {};
      const result = compile(module, context);
      
      expect(result.instructions).toHaveLength(2);
      expect(result.instructions[0]).toEqual({
        type: 'section',
        category: 'instructions',
        title: 'Objective and Role',
        items: ['AIアシスタントとして動作する'],
        cacheHint: 'static'
      });
      expect(result.instructions[1]).toEqual({
        type: 'section',
        category: 'instructions',
        title: 'Processing Methodology',
        items: ['データを分析', '結果を生成'],
        cacheHint: 'static'
      });
    });

    it('SubSectionElementを含むセクションを処理できる', () => {
      const module: PromptModule = {
        methodology: [
          '入力を検証',
          {
            type: 'subsection',
                title: '変換処理',
            items: ['正規化', '特徴抽出']
          } as SubSectionElement,
          '出力を生成'
        ]
      };
      const context = {};
      const result = compile(module, context);
      
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0]).toEqual({
        type: 'section',
        category: 'instructions',
        title: 'Processing Methodology',
        items: [
          '入力を検証',
          '出力を生成',
          {
            type: 'subsection',
                title: '変換処理',
            items: ['正規化', '特徴抽出']
          }
        ],
        cacheHint: 'static'
      });
    });
  });

  describe('DynamicContentの処理', () => {
    it('TextElementを生成するDynamicContent', () => {
      const module: PromptModule<{ value: string }> = {
        state: [
          (context) => ({
            type: 'text',
            content: `Value: ${context.value}`
          } as TextElement)
        ]
      };
      const context = { value: 'test123' };
      const result = compile(module, context);

      expect(result.data).toHaveLength(2);
      // 最初はSectionElement
      expect(result.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Current State',
        items: [],
        cacheHint: 'static'
      });
      // 次にTextElement
      expect(result.data[1]).toEqual({
        type: 'text',
        content: 'Value: test123',
        cacheHint: 'contextual'
      });
    });

    it('MessageElementを生成するDynamicContent', () => {
      const module: PromptModule<{ message: string }> = {
        messages: [
          (context) => ({
            type: 'message',
            content: context.message,
            role: 'user'
          } as MessageElement)
        ]
      };
      const context = { message: 'Hello, AI!' };
      const result = compile(module, context);

      expect(result.data).toHaveLength(2);
      // 最初はSectionElement
      expect(result.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Messages',
        items: [],
        cacheHint: 'static'
      });
      // 次にMessageElement
      expect(result.data[1]).toEqual({
        type: 'message',
        role: 'user',
        content: 'Hello, AI!',
        cacheHint: 'contextual'
      });
    });

    it('MaterialElementを生成するDynamicContent', () => {
      const module: PromptModule<{ doc: { id: string; title: string; content: string } }> = {
        materials: [
          (context) => ({
            type: 'material',
            content: context.doc.content,
            id: context.doc.id,
            title: context.doc.title
          } as MaterialElement)
        ]
      };
      const context = { 
        doc: { 
          id: 'doc1', 
          title: 'API Guide', 
          content: 'API documentation content' 
        } 
      };
      const result = compile(module, context);
      
      expect(result.data).toHaveLength(2);
      // 最初はSectionElement
      expect(result.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Prepared Materials',
        items: [],
        cacheHint: 'static'
      });
      // 次にMaterialElement
      expect(result.data[1]).toEqual({
        type: 'material',
        id: 'doc1',
        title: 'API Guide',
        content: 'API documentation content',
        cacheHint: 'contextual'
      });
    });

    it('ChunkElementを生成するDynamicContent', () => {
      const module: PromptModule<{ chunks: Array<{ content: string; partOf: string }> }> = {
        chunks: [
          (context) => context.chunks.map(chunk => ({
            type: 'chunk',
            content: chunk.content,
            partOf: chunk.partOf
          } as ChunkElement))
        ]
      };
      const context = {
        chunks: [
          { content: 'Part 1 content', partOf: 'document.txt' },
          { content: 'Part 2 content', partOf: 'document.txt' }
        ]
      };
      const result = compile(module, context);
      
      expect(result.data).toHaveLength(3);
      // 最初はSectionElement
      expect(result.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Input Chunks',
        items: [],
        cacheHint: 'static'
      });
      // 次にChunkElement
      expect(result.data[1]).toEqual({
        type: 'chunk',
        partOf: 'document.txt',
        content: 'Part 1 content',
        cacheHint: 'contextual'
      });
      expect(result.data[2]).toEqual({
        type: 'chunk',
        partOf: 'document.txt',
        content: 'Part 2 content',
        cacheHint: 'contextual'
      });
    });

    it('nullを返すDynamicContentは無視される', () => {
      const module: PromptModule<{ includeState: boolean }> = {
        state: [
          '固定の状態',
          (context) => context.includeState 
            ? { type: 'text', content: '動的な状態' } as TextElement
            : null
        ]
      };
      
      const result1 = compile(module, { includeState: true });
      expect(result1.data).toHaveLength(2);
      expect(result1.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Current State',
        items: ['固定の状態'],
        cacheHint: 'static'
      });
      expect(result1.data[1]).toEqual({
        type: 'text',
        content: '動的な状態',
        cacheHint: 'contextual'
      });

      const result2 = compile(module, { includeState: false });
      expect(result2.data).toHaveLength(1);
      expect(result2.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Current State',
        items: ['固定の状態'],
        cacheHint: 'static'
      });
    });
  });

  describe('セクションタイプの分類', () => {
    it('Instructions, Data, Outputセクションが正しく分類される', () => {
      const module: PromptModule = {
        // Instructions
        objective: ['目的'],
        instructions: ['指示'],
        
        // Data
        state: ['状態'],
        messages: ['メッセージ'],
        
        // Output
        cue: ['出力'],
        schema: ['スキーマ']
      };
      const context = {};
      const result = compile(module, context);
      
      expect(result.instructions).toHaveLength(2);
      expect(result.instructions.map(e => e.title)).toEqual([
        'Objective and Role',
        'Instructions'
      ]);
      
      expect(result.data).toHaveLength(2);
      expect(result.data.map(e => e.title)).toEqual([
        'Current State',
        'Messages'
      ]);
      
      expect(result.output).toHaveLength(2);
      expect(result.output.map(e => e.title)).toEqual([
        'Output',
        'Output Schema'
      ]);
    });
  });

  describe('複雑なケース', () => {
    it('文字列、SubSectionElement、DynamicContentを混在させる', () => {
      interface Context {
        currentStep: number;
        totalSteps: number;
        details: string[];
      }
      
      const module: PromptModule<Context> = {
        methodology: [
          '処理を開始',
          (context) => ({
            type: 'text',
            content: `ステップ ${context.currentStep}/${context.totalSteps} を実行中`
          } as TextElement),
          {
            type: 'subsection',
                title: '詳細手順',
            items: ['初期化', '検証', '実行']
          } as SubSectionElement,
          (context) => context.details.map(detail => ({
            type: 'text',
            content: detail
          } as TextElement)),
          '処理を完了'
        ]
      };
      
      const context: Context = {
        currentStep: 3,
        totalSteps: 5,
        details: ['詳細1', '詳細2']
      };
      
      const result = compile(module, context);
      
      expect(result.instructions).toHaveLength(4);
      // 最初のSectionElement（文字列とSubSection）
      expect(result.instructions[0]).toEqual({
        type: 'section',
        category: 'instructions',
        title: 'Processing Methodology',
        items: [
          '処理を開始',
          '処理を完了',
          {
            type: 'subsection',
                title: '詳細手順',
            items: ['初期化', '検証', '実行']
          }
        ],
        cacheHint: 'static'
      });
      // TextElement（ステップ情報）
      expect(result.instructions[1]).toEqual({
        type: 'text',
        content: 'ステップ 3/5 を実行中',
        cacheHint: 'contextual'
      });
      // TextElement（詳細1）
      expect(result.instructions[2]).toEqual({
        type: 'text',
        content: '詳細1',
        cacheHint: 'contextual'
      });
      // TextElement（詳細2）
      expect(result.instructions[3]).toEqual({
        type: 'text',
        content: '詳細2',
        cacheHint: 'contextual'
      });
    });
  });

  describe('標準セクションの文字列処理', () => {
    it('標準セクションに文字列を直接設定できる', () => {
      const module: PromptModule = {
        instructions: 'Direct instruction',  // instructions標準セクション
        state: 'Current state',              // dataカテゴリの標準セクション
        cue: 'Output cue'                    // outputカテゴリの標準セクション
      };
      const context = {};
      const result = compile(module, context);
      
      // instructionsセクションを確認
      expect(result.instructions).toHaveLength(1);
      expect(result.instructions[0]).toMatchObject({
        type: 'section',
        category: 'instructions',
        title: 'Instructions',
        items: ['Direct instruction']
      });
      
      // dataセクションを確認
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toMatchObject({
        type: 'section',
        category: 'data',
        title: 'Current State',
        items: ['Current state']
      });
      
      // outputセクションを確認
      expect(result.output).toHaveLength(1);
      expect(result.output[0]).toMatchObject({
        type: 'section',
        category: 'output',
        title: 'Output',
        items: ['Output cue']
      });
    });

    it('標準セクションにsubsectionを含めることができる', () => {
      const subsection: SubSectionElement = {
        type: 'subsection',
        title: 'Sub Instructions',
        items: ['Sub item']
      };
      
      const module: PromptModule = {
        instructions: [
          'Direct instruction string',
          subsection
        ]
      };
      const context = {};
      const result = compile(module, context);
      
      expect(result.instructions[0]).toMatchObject({
        type: 'section',
        category: 'instructions',
        title: 'Instructions',
        items: [
          'Direct instruction string',
          {
            type: 'subsection',
            title: 'Sub Instructions',
                items: ['Sub item']
          }
        ]
      });
    });

    it('重複する文字列を許容する', () => {
      const module: PromptModule = {
        instructions: [
          'Same instruction',
          'Same instruction'
        ]
      };
      const context = {};
      const result = compile(module, context);
      
      // 重複が許容されることを確認
      expect(result.instructions[0].items).toEqual([
        'Same instruction',
        'Same instruction'
      ]);
    });

    it('重複するsubsectionを許容する', () => {
      const subsection1: SubSectionElement = {
        type: 'subsection',
        title: 'Same Subsection',
        items: ['Item 1']
      };
      
      const subsection2: SubSectionElement = {
        type: 'subsection',
        title: 'Same Subsection',
        items: ['Item 2']
      };
      
      const module: PromptModule = {
        state: [  // dataカテゴリの標準セクション
          subsection1,
          subsection2
        ]
      };
      const context = {};
      const result = compile(module, context);
      
      // 同名のサブセクションが両方存在することを確認
      const subsections = result.data[0].items.filter(
        (item): item is SubSectionElement => 
          typeof item === 'object' && item.type === 'subsection'
      );
      expect(subsections).toHaveLength(2);
      expect(subsections[0].title).toBe('Same Subsection');
      expect(subsections[1].title).toBe('Same Subsection');
      expect(subsections[0].items).toEqual(['Item 1']);
      expect(subsections[1].items).toEqual(['Item 2']);
    });
  });

  describe('意図的な重複の使用例', () => {
    it('セパレータとしての重複を許容', () => {
      const module: PromptModule = {
        methodology: [
          'ステップ1: 初期化',
          '---',
          'ステップ2: 処理',
          '---',
          'ステップ3: 完了',
          '---'
        ]
      };
      const context = {};
      const result = compile(module, context);
      
      const items = result.instructions[0].items;
      expect(items.filter(item => item === '---')).toHaveLength(3);
    });
    
    it('強調のための意図的な繰り返し', () => {
      const module: PromptModule = {
        guidelines: [
          '重要: 必ずエラーハンドリングを行う',
          'データを検証する',
          'ログを記録する',
          '重要: 必ずエラーハンドリングを行う'  // 意図的な繰り返し
        ]
      };
      const context = {};
      const result = compile(module, context);
      
      const items = result.instructions[0].items;
      expect(items[0]).toBe('重要: 必ずエラーハンドリングを行う');
      expect(items[3]).toBe('重要: 必ずエラーハンドリングを行う');
    });
  });

  describe('DynamicContentの拡張機能', () => {
    it('DynamicContentで文字列を直接返せる', () => {
      interface Context {
        name: string;
      }
      
      const module: PromptModule<Context> = {
        state: [
          (ctx) => `ユーザー名: ${ctx.name}`  // 文字列を直接返す
        ]
      };
      
      const context = { name: 'Alice' };
      const result = compile(module, context);
      
      expect(result.data[0].items).toEqual(['ユーザー名: Alice']);
    });
    
    it('DynamicContentで文字列配列を直接返せる', () => {
      interface Context {
        items: string[];
      }
      
      const module: PromptModule<Context> = {
        state: [
          (ctx) => ctx.items.map(item => `- ${item}`)  // 文字列配列を直接返す
        ]
      };
      
      const context = { items: ['item1', 'item2', 'item3'] };
      const result = compile(module, context);
      
      expect(result.data[0].items).toEqual([
        '- item1',
        '- item2',
        '- item3'
      ]);
    });
    
    it('DynamicContentで混在した配列を返せる', () => {
      interface Context {
        count: number;
      }
      
      const module: PromptModule<Context> = {
        methodology: [
          (ctx) => [
            'プロセス開始',  // 文字列
            `合計: ${ctx.count}件`,  // 文字列
            { type: 'text', content: '詳細情報' } as TextElement  // Element
          ]
        ]
      };
      
      const context = { count: 5 };
      const result = compile(module, context);
      
      expect(result.instructions).toHaveLength(2);
      expect(result.instructions[0]).toEqual({
        type: 'section',
        category: 'instructions',
        title: 'Processing Methodology',
        items: ['プロセス開始', '合計: 5件'],
        cacheHint: 'contextual'
      });
      expect(result.instructions[1]).toEqual({
        type: 'text',
        content: '詳細情報',
        cacheHint: 'contextual'
      });
    });
    
    it('DynamicContentでnull/undefinedを返すと無視される', () => {
      interface Context {
        showOptional: boolean;
      }
      
      const module: PromptModule<Context> = {
        guidelines: [
          '必須ガイドライン',
          (ctx) => ctx.showOptional ? 'オプションガイドライン' : null,
          (ctx) => ctx.showOptional ? undefined : '代替ガイドライン'
        ]
      };
      
      const context = { showOptional: false };
      const result = compile(module, context);
      
      expect(result.instructions[0].items).toEqual([
        '必須ガイドライン',
        '代替ガイドライン'
      ]);
    });
  });

  describe('createContext', () => {
    it('createContextがある場合はそれを使用', () => {
      const module: PromptModule<{ value: number }> = {
        createContext: () => ({ value: 42 })
      };
      
      const context = createContext(module);
      expect(context).toEqual({ value: 42 });
    });

    it('createContextがない場合は空オブジェクトを返す', () => {
      const module: PromptModule = {};

      const context = createContext(module);
      expect(context).toEqual({});
    });
  });

  describe('Elementのみで構成されるセクション', () => {
    it('MessageElementのみのmessagesセクションでもSectionElementが作成される', () => {
      const module: PromptModule = {
        messages: [
          { type: 'message', role: 'user', content: 'Hello' } as MessageElement,
          { type: 'message', role: 'assistant', content: 'Hi there!' } as MessageElement
        ]
      };
      const context = {};
      const result = compile(module, context);

      expect(result.data).toHaveLength(3);
      // 最初はSectionElement
      expect(result.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Messages',
        items: [],
        cacheHint: 'static'
      });
      // 次にMessageElement
      expect(result.data[1]).toEqual({
        type: 'message',
        role: 'user',
        content: 'Hello',
        cacheHint: 'static'
      });
      expect(result.data[2]).toEqual({
        type: 'message',
        role: 'assistant',
        content: 'Hi there!',
        cacheHint: 'static'
      });
    });

    it('MaterialElementのみのmaterialsセクションでもSectionElementが作成される', () => {
      const module: PromptModule = {
        materials: [
          { type: 'material', id: 'doc1', title: 'Document 1', content: 'Content 1' } as MaterialElement
        ]
      };
      const context = {};
      const result = compile(module, context);

      expect(result.data).toHaveLength(2);
      // 最初はSectionElement
      expect(result.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Prepared Materials',
        items: [],
        cacheHint: 'static'
      });
      // 次にMaterialElement
      expect(result.data[1]).toEqual({
        type: 'material',
        id: 'doc1',
        title: 'Document 1',
        content: 'Content 1',
        cacheHint: 'static'
      });
    });

    it('ChunkElementのみのchunksセクションでもSectionElementが作成される', () => {
      const module: PromptModule = {
        chunks: [
          { type: 'chunk', partOf: 'dataset', index: 0, total: 2, content: 'Chunk 1' } as ChunkElement,
          { type: 'chunk', partOf: 'dataset', index: 1, total: 2, content: 'Chunk 2' } as ChunkElement
        ]
      };
      const context = {};
      const result = compile(module, context);

      expect(result.data).toHaveLength(3);
      // 最初はSectionElement
      expect(result.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Input Chunks',
        items: [],
        cacheHint: 'static'
      });
      // 次にChunkElement
      expect(result.data[1]).toEqual({
        type: 'chunk',
        partOf: 'dataset',
        index: 0,
        total: 2,
        content: 'Chunk 1',
        cacheHint: 'static'
      });
      expect(result.data[2]).toEqual({
        type: 'chunk',
        partOf: 'dataset',
        index: 1,
        total: 2,
        content: 'Chunk 2',
        cacheHint: 'static'
      });
    });
  });

  describe('cacheHint', () => {
    it('should mark all-static section elements as static', () => {
      const module: PromptModule = {
        objective: ['Be helpful'],
        persona: ['A friendly assistant']
      };
      const result = compile(module);

      expect(result.instructions[0]).toMatchObject({
        type: 'section',
        title: 'Objective and Role',
        cacheHint: 'static'
      });
      expect(result.instructions[1]).toMatchObject({
        type: 'section',
        title: 'Persona and Character',
        cacheHint: 'static'
      });
    });

    it('should mark section with DynamicContent as contextual', () => {
      const module: PromptModule<{ user: string }> = {
        createContext: () => ({ user: 'Alice' }),
        objective: [
          'Be helpful',
          (ctx) => `Current user: ${ctx.user}`
        ]
      };
      const result = compile(module);

      expect(result.instructions[0]).toMatchObject({
        type: 'section',
        title: 'Objective and Role',
        cacheHint: 'contextual'
      });
    });

    it('should mark standalone DynamicElement from static source as static', () => {
      const staticChunk: ChunkElement = {
        type: 'chunk',
        partOf: 'dataset',
        index: 0,
        total: 1,
        content: 'Chunk data'
      };
      const module: PromptModule = {
        chunks: [staticChunk]
      };
      const result = compile(module);

      // SectionElement (index 0) is static
      expect(result.data[0]).toMatchObject({
        type: 'section',
        cacheHint: 'static'
      });
      // ChunkElement (index 1) is static
      expect(result.data[1]).toMatchObject({
        type: 'chunk',
        cacheHint: 'static'
      });
    });

    it('should mark standalone DynamicElement from DynamicContent as contextual', () => {
      const module: PromptModule<{ data: string }> = {
        createContext: () => ({ data: 'test' }),
        materials: [
          (ctx): MaterialElement => ({
            type: 'material',
            id: 'mat1',
            title: 'Dynamic Material',
            content: ctx.data
          })
        ]
      };
      const result = compile(module);

      // SectionElement should be static (no plain items from dynamic)
      expect(result.data[0]).toMatchObject({
        type: 'section',
        cacheHint: 'static'
      });
      // MaterialElement should be contextual
      expect(result.data[1]).toMatchObject({
        type: 'material',
        cacheHint: 'contextual'
      });
    });

    it('should mark section with dynamic SubSection content as contextual', () => {
      const module: PromptModule<{ level: string }> = {
        createContext: () => ({ level: 'expert' }),
        instructions: [
          {
            type: 'subsection',
            title: 'Behavior',
            items: [
              'Always be polite',
              (ctx: { level: string }) => `Expertise level: ${ctx.level}`
            ]
          } as SubSectionElement<{ level: string }>
        ]
      };
      const result = compile(module);

      expect(result.instructions[0]).toMatchObject({
        type: 'section',
        title: 'Instructions',
        cacheHint: 'contextual'
      });
    });

    it('should mark mixed static/dynamic standalone elements correctly', () => {
      const staticText: TextElement = { type: 'text', content: 'Static note' };
      const module: PromptModule<{ info: string }> = {
        createContext: () => ({ info: 'dynamic' }),
        state: [
          staticText,
          (ctx): TextElement => ({ type: 'text', content: ctx.info })
        ]
      };
      const result = compile(module);

      // SectionElement (empty items since both are DynamicElements)
      expect(result.data[0]).toMatchObject({
        type: 'section',
        cacheHint: 'static'
      });
      // Static TextElement
      expect(result.data[1]).toMatchObject({
        type: 'text',
        content: 'Static note',
        cacheHint: 'static'
      });
      // Dynamic TextElement
      expect(result.data[2]).toMatchObject({
        type: 'text',
        content: 'dynamic',
        cacheHint: 'contextual'
      });
    });

    it('should not add cacheHint when distribute is called without resolve', () => {
      // distribute() without resolve() should not add cacheHint (backward compat)
      const resolved = {
        objective: ['Be helpful']
      };
      const result = distribute(resolved);

      expect(result.instructions[0]).toEqual({
        type: 'section',
        category: 'instructions',
        title: 'Objective and Role',
        items: ['Be helpful']
      });
      expect((result.instructions[0] as any).cacheHint).toBeUndefined();
    });

    it('should handle DynamicContent returning string arrays correctly', () => {
      const module: PromptModule<{ items: string[] }> = {
        createContext: () => ({ items: ['a', 'b'] }),
        guidelines: [
          'Static guideline',
          (ctx) => ctx.items
        ]
      };
      const result = compile(module);

      expect(result.instructions[0]).toMatchObject({
        type: 'section',
        title: 'Guidelines',
        cacheHint: 'contextual'
      });
    });

    it('should independently determine cacheHint per section', () => {
      const module: PromptModule<{ name: string }> = {
        createContext: () => ({ name: 'test' }),
        objective: ['Static objective'],
        persona: [(ctx) => `I am ${ctx.name}`]
      };
      const result = compile(module);

      expect(result.instructions[0]).toMatchObject({
        title: 'Objective and Role',
        cacheHint: 'static'
      });
      expect(result.instructions[1]).toMatchObject({
        title: 'Persona and Character',
        cacheHint: 'contextual'
      });
    });
  });
});