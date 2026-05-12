import { describe, it, expect } from 'vitest';
import { compile } from '@modular-prompt/core';
import { streamProcessing } from './stream-processing';
import type { StreamProcessingContext } from './stream-processing';

describe('stream-processing modules', () => {
  describe('streamProcessing', () => {
    it('基本的な構造を持つ', () => {
      const context: StreamProcessingContext = {};
      const result = compile(streamProcessing, context);
      
      // 必須セクションが存在することを確認
      const allSections = [
        ...result.instructions,
        ...result.data,
        ...result.output
      ].filter(e => e.type === 'section');
      
      const sectionTitles = allSections.map(s => s.title);
      
      expect(sectionTitles).toContain('Objective and Role');
      expect(sectionTitles).toContain('Term Explanations');
      expect(sectionTitles).toContain('Processing Methodology');
      expect(sectionTitles).toContain('Instructions');
      expect(sectionTitles).toContain('Output');
    });

    it('stateがある場合Current Stateセクションを生成', () => {
      const context: StreamProcessingContext = {
        state: {
          content: 'Previous iteration result',
          usage: 150
        }
      };
      
      const result = compile(streamProcessing, context);
      const chunkElements = result.data.filter(e => e.type === 'chunk');
      expect(chunkElements).toHaveLength(1);
      expect(chunkElements[0]).toMatchObject({
        type: 'chunk',
        partOf: 'state',
        content: 'Previous iteration result',
        usage: 150
      });
    });

    it('chunksがある場合Input Chunksセクションを生成', () => {
      const context: StreamProcessingContext = {
        chunks: [
          {
            content: 'Chunk 1 content',
            partOf: 'Document A',
            usage: 50
          },
          {
            content: 'Chunk 2 content',
            partOf: 'Document B',
            usage: 75,
            attachments: [{ type: 'image', url: 'image.png' }]
          }
        ]
      };
      
      const result = compile(streamProcessing, context);
      const chunkElements = result.data.filter(e => e.type === 'chunk');
      expect(chunkElements).toHaveLength(2);
      expect(chunkElements[0]).toMatchObject({
        type: 'chunk',
        partOf: 'Document A',
        index: 0,
        content: 'Chunk 1 content',
        usage: 50
      });
      expect(chunkElements[1]).toMatchObject({
        type: 'chunk',
        partOf: 'Document B',
        index: 1,
        content: 'Chunk 2 content',
        usage: 75
      });
    });

    it('rangeを使用してchunksをスライスできる', () => {
      const context: StreamProcessingContext = {
        chunks: [
          { content: 'Chunk 0' },
          { content: 'Chunk 1' },
          { content: 'Chunk 2' },
          { content: 'Chunk 3' },
          { content: 'Chunk 4' }
        ],
        range: {
          start: 1,
          end: 4
        }
      };

      const result = compile(streamProcessing, context);

      // ChunkElementを直接チェック（SectionElement.itemsではなく）
      const chunkElements = result.data.filter(e => e.type === 'chunk' && e.partOf === 'input');
      expect(chunkElements).toHaveLength(3); // インデックス1, 2, 3
      expect(chunkElements[0]).toMatchObject({
        type: 'chunk',
        content: 'Chunk 1',
        partOf: 'input',
        index: 0
      });
      expect(chunkElements[2]).toMatchObject({
        type: 'chunk',
        content: 'Chunk 3',
        partOf: 'input',
        index: 2
      });
    });
  });

  describe('streamProcessing with targetTokens', () => {
    it('targetTokensが設定されている場合サイズ制御の指示を追加', () => {
      const context: StreamProcessingContext = {
        state: { content: 'State' },
        chunks: [{ content: 'Chunk' }]
      };
      
      const result = compile(streamProcessing, context);
      
      // 基本的なセクションが存在
      const allSections = [
        ...result.instructions,
        ...result.data,
        ...result.output
      ].filter(e => e.type === 'section');
      
      const sectionTitles = allSections.map(s => s.title);
      
      expect(sectionTitles).toContain('Objective and Role');
      expect(sectionTitles).toContain('Processing Methodology');
      expect(sectionTitles).toContain('Instructions');
      expect(sectionTitles).toContain('Guidelines'); // 追加のガイドライン
    });

    it('targetTokensが設定されている場合サイズ制御の指示を追加', () => {
      const context: StreamProcessingContext = {
        targetTokens: 1000,
        state: {
          content: 'Large state content',
          usage: 500
        }
      };
      
      const result = compile(streamProcessing, context);
      const textElements = result.instructions.filter(e => e.type === 'text');
      const sizeInstruction = textElements.find(e =>
        e.type === 'text' && e.content.includes('1000 tokens')
      );
      expect(sizeInstruction).toBeDefined();
    });

    it('使用量が閾値を超える場合は積極的な削減を指示', () => {
      const context: StreamProcessingContext = {
        targetTokens: 1000,
        state: {
          content: 'Very large state',
          usage: 900 // 0.8 * 1000 = 800を超えている
        }
      };
      
      const result = compile(streamProcessing, context);
      const textElements = result.instructions.filter(e => e.type === 'text');
      const reductionInstruction = textElements.find(e =>
        e.type === 'text' && e.content.includes('aggressively reduce')
      );
      expect(reductionInstruction).toBeDefined();
    });
  });

  describe('streamProcessing with range', () => {
    it('最初のイテレーションの場合、初期化の指示を生成', () => {
      const context: StreamProcessingContext = {
        chunks: [{ content: 'chunk1' }, { content: 'chunk2' }],
        range: { start: 0, end: 1 }
      };
      
      const result = compile(streamProcessing, context);
      
      // TextElementが直接instructions配列に追加される
      const textElements = result.instructions.filter(e => e.type === 'text');
      const firstIterationText = textElements.find(e =>
        e.type === 'text' && e.content.includes('first iteration')
      );
      expect(firstIterationText).toBeDefined();
    });

    it('最終イテレーションの場合、特別な指示を生成', () => {
      const context: StreamProcessingContext = {
        chunks: [{ content: 'chunk1' }, { content: 'chunk2' }, { content: 'chunk3' }],
        range: { start: 2, end: 3 } // end === chunks.length
      };
      
      const result = compile(streamProcessing, context);
      
      const textElements = result.instructions.filter(e => e.type === 'text');
      const finalIterationText = textElements.find(e =>
        e.type === 'text' && e.content.includes('final iteration')
      );
      expect(finalIterationText).toBeDefined();
    });
  });
});