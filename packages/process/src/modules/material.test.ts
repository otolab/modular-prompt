import { describe, it, expect } from 'vitest';
import { compile } from '@modular-prompt/core';
import { withMaterials, answerWithReferences } from './material';
import type { MaterialContext } from './material';

describe('material modules', () => {
  describe('withMaterials', () => {
    it('材料がない場合は空のコンテンツを返す', () => {
      const context: MaterialContext = {};
      const result = compile(withMaterials, context);
      
      // CompiledPromptオブジェクトが返される
      expect(result).toBeDefined();
      expect(result.instructions).toBeDefined();
      expect(result.data).toBeDefined();
      expect(result.output).toBeDefined();
      
      // termsはinstructionsセクションにある
      const termsSection = result.instructions.find(e => e.type === 'section' && e.title === 'Term Explanations');
      expect(termsSection).toBeDefined();
    });

    it('材料がある場合はmaterialセクションを生成', () => {
      const context: MaterialContext = {
        materials: [
          {
            id: 'doc1',
            title: 'Document 1',
            content: 'This is the content of document 1'
          },
          {
            id: 'doc2', 
            title: 'Document 2',
            content: 'This is the content of document 2',
            usage: 100
          }
        ]
      };
      
      const result = compile(withMaterials, context);
      
      // Materialsセクションはdataに含まれる
      const materialElements = result.data.filter(e => e.type === 'material');
      expect(materialElements).toHaveLength(2);

      expect(materialElements[0]).toMatchObject({
        type: 'material',
        id: 'doc1',
        title: 'Document 1',
        content: 'This is the content of document 1'
      });
      expect(materialElements[1]).toMatchObject({
        type: 'material',
        id: 'doc2',
        title: 'Document 2',
        content: 'This is the content of document 2',
        usage: 100
      });
    });
  });

  describe('answerWithReferences', () => {
    it('withMaterialsの機能を継承し、追加のinstructionsを持つ', () => {
      const context: MaterialContext = {
        materials: [
          {
            id: 'ref1',
            title: 'Reference 1',
            content: 'Reference content'
          }
        ]
      };
      
      const result = compile(answerWithReferences, context);
      
      // Instructionsセクションを探す
      const instructionsSection = result.instructions.find(e => e.type === 'section' && e.title === 'Instructions');
      expect(instructionsSection).toBeDefined();
      
      if (instructionsSection?.type === 'section') {
        // citation関連の指示が含まれていることを確認
        const instructionTexts = instructionsSection.items
          .filter(item => typeof item === 'string')
          .join(' ');
        
        const hasCitationInstruction = 
          instructionTexts.includes('(refs:') || 
          instructionTexts.includes('learned-knowledge');
        expect(hasCitationInstruction).toBe(true);
      }
      
      // MaterialElementsが存在することを確認
      const materialElements = result.data.filter(e => e.type === 'material');
      expect(materialElements.length).toBeGreaterThan(0);
    });

    it('複数の材料を扱える', () => {
      const context: MaterialContext = {
        materials: [
          { id: 'a', title: 'A', content: 'Content A' },
          { id: 'b', title: 'B', content: 'Content B' },
          { id: 'c', title: 'C', content: 'Content C' }
        ]
      };
      
      const result = compile(answerWithReferences, context);
      const materialsSection = result.data.find(e => e.type === 'section' && e.title === 'Materials');
      
      if (materialsSection?.type === 'section') {
        const materials = materialsSection.items.filter(item => {
          return typeof item === 'object' && 'type' in item && item.type === 'material';
        });
        expect(materials).toHaveLength(3);
      }
    });
  });
});