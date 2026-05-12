import { describe, it, expect } from 'vitest';
import { compile } from './compile.js';
import { merge } from './merge.js';
import type { PromptModule } from './types.js';

describe('Core Integration Tests', () => {
  describe('Basic Module Definition to Prompt Generation', () => {
    it('should compile a simple module', () => {
      const module: PromptModule = {
        instructions: [
          'You are a helpful assistant.',
          'Be concise and accurate.'
        ],
        state: [
          'User input: Hello, world!'
        ],
        cue: [
          'Generate a friendly response.'
        ]
      };
      
      const compiled = compile(module);
      
      expect(compiled.instructions).toHaveLength(1);
      expect(compiled.instructions[0].type).toBe('section');
      expect(compiled.instructions[0]).toMatchObject({
        type: 'section',
        title: 'Instructions',
        items: [
          'You are a helpful assistant.',
          'Be concise and accurate.'
        ]
      });
      
      expect(compiled.data).toHaveLength(1);
      expect(compiled.data[0].type).toBe('section');
      expect(compiled.data[0]).toMatchObject({
        type: 'section',
        title: 'Current State',
        items: ['User input: Hello, world!']
      });
      
      expect(compiled.output).toHaveLength(1);
      expect(compiled.output[0].type).toBe('section');
      expect(compiled.output[0]).toMatchObject({
        type: 'section',
        title: 'Output',
        items: ['Generate a friendly response.']
      });
    });
    
    it('should handle modules with context', () => {
      interface MyContext {
        userName: string;
        taskType: string;
      }
      
      const module: PromptModule<MyContext> = {
        instructions: [
          (ctx) => `You are assisting ${ctx.userName}.`,
          {
            type: 'subsection',
            title: 'Task',
            items: [(ctx: MyContext) => `Perform ${ctx.taskType} task`]
          }
        ],
        state: [
          (ctx) => `User: ${ctx.userName}`,
          (ctx) => `Request: ${ctx.taskType}`
        ]
      };
      
      const context: MyContext = {
        userName: 'Alice',
        taskType: 'translation'
      };
      
      const compiled = compile(module, context);
      
      expect(compiled.instructions).toHaveLength(1);
      const instructionSection = compiled.instructions[0];
      expect(instructionSection.type).toBe('section');
      if (instructionSection.type === 'section') {
        expect(instructionSection.items).toContain('You are assisting Alice.');
        
        const subsection = instructionSection.items.find(
          item => typeof item === 'object' && item.type === 'subsection'
        );
        expect(subsection).toBeDefined();
        if (subsection && typeof subsection === 'object' && subsection.type === 'subsection') {
          expect(subsection.title).toBe('Task');
          expect(subsection.items).toContain('Perform translation task');
        }
      }
    });
  });
  
  describe('Complex Module with Elements', () => {
    it('should handle various element types via DynamicContent', () => {
      const module: PromptModule = {
        instructions: [
          'System instruction',
          {
            type: 'subsection',
            title: 'Rules',
            items: ['Rule 1', 'Rule 2']
          }
        ],
        state: [
          () => ({
            type: 'material',
            id: 'doc-1',
            title: 'Documentation',
            content: 'API documentation content',
            usage: 100
          }),
          () => ({
            type: 'message',
            role: 'user',
            content: 'What is the weather?'
          }),
          () => ({
            type: 'message',
            role: 'assistant',
            content: 'I can help with weather information.'
          })
        ],
        cue: [
          () => ({
            type: 'chunk',
            partOf: 'response.txt',
            index: 1,
            total: 3,
            content: 'First part of response'
          })
        ]
      };
      
      const compiled = compile(module);
      
      // Check instructions - should have 1 section with instruction and subsection
      expect(compiled.instructions).toHaveLength(1);
      expect(compiled.instructions[0].type).toBe('section');
      const instructionSection = compiled.instructions[0];
      if (instructionSection.type === 'section') {
        expect(instructionSection.items).toContain('System instruction');
        const rulesSubsection = instructionSection.items.find(
          item => typeof item === 'object' && item.type === 'subsection' && item.title === 'Rules'
        );
        expect(rulesSubsection).toBeDefined();
      }
      
      // Check data - should have 4 elements (SectionElement, Material, Message, Message)
      expect(compiled.data).toHaveLength(4);

      // 最初はSectionElement
      expect(compiled.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Current State',
        items: [],
        cacheHint: 'static'
      });

      expect(compiled.data[1]).toEqual({
        type: 'material',
        id: 'doc-1',
        title: 'Documentation',
        content: 'API documentation content',
        usage: 100,
        cacheHint: 'contextual'
      });
      expect(compiled.data[2]).toEqual({
        type: 'message',
        role: 'user',
        content: 'What is the weather?',
        cacheHint: 'contextual'
      });
      expect(compiled.data[3]).toEqual({
        type: 'message',
        role: 'assistant',
        content: 'I can help with weather information.',
        cacheHint: 'contextual'
      });

      // Check output - should have 2 elements (SectionElement, ChunkElement)
      expect(compiled.output).toHaveLength(2);

      // 最初はSectionElement
      expect(compiled.output[0]).toEqual({
        type: 'section',
        category: 'output',
        title: 'Output',
        items: [],
        cacheHint: 'static'
      });

      expect(compiled.output[1]).toEqual({
        type: 'chunk',
        partOf: 'response.txt',
        index: 1,
        total: 3,
        content: 'First part of response',
        cacheHint: 'contextual'
      });
    });
  });
  
  describe('Module Merging', () => {
    it('should merge multiple modules', () => {
      const baseModule: PromptModule = {
        instructions: [
          'Base instruction 1',
          'Base instruction 2'
        ],
        state: ['Base data']
      };
      
      const extensionModule: PromptModule = {
        instructions: [
          'Extension instruction'
        ],
        state: ['Extension data'],
        cue: ['Generate output']
      };
      
      const merged = merge(baseModule, extensionModule);
      const compiled = compile(merged);
      
      // Instructions should be combined
      expect(compiled.instructions).toHaveLength(1);
      const instructionSection = compiled.instructions[0];
      if (instructionSection.type === 'section') {
        expect(instructionSection.items).toContain('Base instruction 1');
        expect(instructionSection.items).toContain('Base instruction 2');
        expect(instructionSection.items).toContain('Extension instruction');
      }
      
      // Data should be combined
      expect(compiled.data).toHaveLength(1);
      const dataSection = compiled.data[0];
      if (dataSection.type === 'section') {
        expect(dataSection.items).toContain('Base data');
        expect(dataSection.items).toContain('Extension data');
      }
      
      // Output from extension
      expect(compiled.output).toHaveLength(1);
    });
    
    it('should merge subsections with same title', () => {
      const module1: PromptModule = {
        instructions: [
          {
            type: 'subsection',
            title: 'Guidelines',
            items: ['Guideline 1', 'Guideline 2']
          }
        ]
      };
      
      const module2: PromptModule = {
        instructions: [
          {
            type: 'subsection',
            title: 'Guidelines',
            items: ['Guideline 3', 'Guideline 4']
          },
          {
            type: 'subsection',
            title: 'Rules',
            items: ['Rule 1']
          }
        ]
      };
      
      const merged = merge(module1, module2);
      const compiled = compile(merged);
      
      expect(compiled.instructions).toHaveLength(1);
      const section = compiled.instructions[0];
      if (section.type === 'section') {
        // Find Guidelines subsection
        const guidelines = section.items.find(
          item => typeof item === 'object' && 
                  item.type === 'subsection' && 
                  item.title === 'Guidelines'
        );
        
        expect(guidelines).toBeDefined();
        if (guidelines && typeof guidelines === 'object' && guidelines.type === 'subsection') {
          expect(guidelines.items).toHaveLength(4);
          expect(guidelines.items).toContain('Guideline 1');
          expect(guidelines.items).toContain('Guideline 2');
          expect(guidelines.items).toContain('Guideline 3');
          expect(guidelines.items).toContain('Guideline 4');
        }
        
        // Find Rules subsection
        const rules = section.items.find(
          item => typeof item === 'object' && 
                  item.type === 'subsection' && 
                  item.title === 'Rules'
        );
        expect(rules).toBeDefined();
        if (rules && typeof rules === 'object' && rules.type === 'subsection') {
          expect(rules.items).toContain('Rule 1');
        }
      }
    });
  });
  
  describe('Context Merging', () => {
    it('should merge createContext functions', () => {
      interface Context1 {
        value1: string;
        shared: string;
      }
      
      interface Context2 {
        value2: number;
        shared: string;
      }
      
      type MergedContext = Context1 & Context2;
      
      const module1: PromptModule<Context1> = {
        createContext: () => ({
          value1: 'hello',
          shared: 'from module1'
        }),
        instructions: [(ctx: Context1) => `Value1: ${ctx.value1}, Shared: ${ctx.shared}`]
      };
      
      const module2: PromptModule<Context2> = {
        createContext: () => ({
          value2: 42,
          shared: 'from module2'
        }),
        instructions: [(ctx: Context2) => `Value2: ${ctx.value2}, Shared: ${ctx.shared}`]
      };
      
      const merged = merge<MergedContext>(module1, module2);
      const compiled = compile(merged);
      
      // Context should be merged with module2's value overwriting module1's
      expect(compiled.instructions).toHaveLength(1);
      const section = compiled.instructions[0];
      if (section.type === 'section') {
        expect(section.items).toContain('Value1: hello, Shared: from module2');
        expect(section.items).toContain('Value2: 42, Shared: from module2');
      }
    });
  });
  
  describe('Dynamic Content', () => {
    it('should resolve dynamic content functions', () => {
      const module: PromptModule<{ count: number }> = {
        instructions: [
          'Static instruction',
          (ctx) => `Dynamic instruction with count: ${ctx.count}`,
          {
            type: 'subsection',
            title: 'Dynamic Subsection',
            items: [
              (ctx) => `Item ${ctx.count}`,
              (ctx) => `Item ${ctx.count + 1}`
            ]
          }
        ]
      };
      
      const compiled = compile(module, { count: 5 });
      
      expect(compiled.instructions).toHaveLength(1);
      const section = compiled.instructions[0];
      if (section.type === 'section') {
        expect(section.items).toContain('Static instruction');
        expect(section.items).toContain('Dynamic instruction with count: 5');
        
        const subsection = section.items.find(
          item => typeof item === 'object' && 
                  item.type === 'subsection' &&
                  item.title === 'Dynamic Subsection'
        );
        
        expect(subsection).toBeDefined();
        if (subsection && typeof subsection === 'object' && subsection.type === 'subsection') {
          expect(subsection.items).toContain('Item 5');
          expect(subsection.items).toContain('Item 6');
        }
      }
    });
  });
  
  describe('Element Ordering', () => {
    it('should order elements correctly (regular elements before subsections)', () => {
      const module: PromptModule = {
        instructions: [
          {
            type: 'subsection',
            title: 'First Subsection',
            items: ['Sub item 1']
          },
          'Regular string 1',
          'Text element',
          {
            type: 'subsection',
            title: 'Second Subsection',
            items: ['Sub item 2']
          },
          'Regular string 2'
        ]
      };
      
      const compiled = compile(module);
      
      expect(compiled.instructions).toHaveLength(1);
      const section = compiled.instructions[0];
      if (section.type === 'section') {
        // Check that regular items come before subsections
        const regularItems = section.items.filter(
          item => typeof item === 'string'
        );
        const subsections = section.items.filter(
          item => typeof item === 'object' && item.type === 'subsection'
        );
        
        expect(regularItems).toHaveLength(3);
        expect(subsections).toHaveLength(2);
        
        // Find indices
        const lastRegularIndex = section.items.lastIndexOf(regularItems[regularItems.length - 1]);
        const firstSubsectionIndex = section.items.indexOf(subsections[0]);
        
        expect(lastRegularIndex).toBeLessThan(firstSubsectionIndex);
      }
    });
  });
  
  describe('Error Cases', () => {
    it('should handle empty modules', () => {
      const emptyModule: PromptModule = {};
      const compiled = compile(emptyModule);
      
      expect(compiled.instructions).toEqual([]);
      expect(compiled.data).toEqual([]);
      expect(compiled.output).toEqual([]);
    });
    
    it('should handle null/undefined values gracefully', () => {
      const module: PromptModule = {
        instructions: [
          'Valid instruction',
          undefined as any,
          null as any,
          'Another valid instruction'
        ].filter(Boolean),
        state: undefined,
        cue: null as any
      };
      
      const compiled = compile(module);
      
      expect(compiled.instructions).toHaveLength(1);
      const section = compiled.instructions[0];
      if (section.type === 'section') {
        expect(section.items).toHaveLength(2);
        expect(section.items).toContain('Valid instruction');
        expect(section.items).toContain('Another valid instruction');
      }
      
      expect(compiled.data).toEqual([]);
      expect(compiled.output).toEqual([]);
    });
  });
  
  describe('Complete End-to-End Flow', () => {
    it('should handle a complete prompt module workflow', () => {
      // Define a base module
      const baseSystemModule: PromptModule = {
        instructions: [
          'You are an AI assistant specializing in code review.',
          {
            type: 'subsection',
            title: 'Code Review Guidelines',
            items: [
              'Check for bugs and potential issues',
              'Suggest improvements for readability',
              'Ensure best practices are followed'
            ]
          }
        ]
      };
      
      // Define a task-specific module
      interface TaskContext {
        language: string;
        codeSnippet: string;
        focusAreas: string[];
      }
      
      const codeReviewModule: PromptModule<TaskContext> = {
        instructions: [
          (ctx: TaskContext) => `Focus on ${ctx.language} best practices.`,
          {
            type: 'subsection',
            title: 'Focus Areas',
            items: [
              (ctx: TaskContext) => ctx.focusAreas
            ]
          }
        ],
        state: [
          (ctx: TaskContext) => ({
            type: 'material',
            id: 'code-snippet',
            title: `${ctx.language} Code`,
            content: ctx.codeSnippet
          })
        ],
        cue: [
          'Provide a detailed code review with:',
          {
            type: 'subsection',
            title: 'Review Structure',
            items: [
              'Summary of findings',
              'Detailed issues (if any)',
              'Improvement suggestions',
              'Positive aspects'
            ]
          }
        ]
      };
      
      // Merge modules
      const merged = merge(baseSystemModule, codeReviewModule);
      
      // Create context
      const context: TaskContext = {
        language: 'TypeScript',
        codeSnippet: `
function processData(data: any[]) {
  for (let i = 0; i < data.length; i++) {
    console.log(data[i]);
  }
}`,
        focusAreas: [
          'Type safety',
          'Performance optimization',
          'Modern JavaScript features'
        ]
      };
      
      // Compile the merged module
      const compiled = compile(merged, context);
      
      // Verify the complete prompt structure
      expect(compiled.instructions).toBeDefined();
      expect(compiled.data).toBeDefined();
      expect(compiled.output).toBeDefined();
      
      // Check instructions section
      expect(compiled.instructions.length).toBeGreaterThan(0);
      const instructionSection = compiled.instructions[0];
      if (instructionSection.type === 'section') {
        // Should contain base instructions
        expect(instructionSection.items).toContain('You are an AI assistant specializing in code review.');
        expect(instructionSection.items).toContain('Focus on TypeScript best practices.');
        
        // Should have merged subsections
        const subsections = instructionSection.items.filter(
          item => typeof item === 'object' && item.type === 'subsection'
        );
        
        const guidelinesSubsection = subsections.find(
          (s: any) => s.title === 'Code Review Guidelines'
        );
        expect(guidelinesSubsection).toBeDefined();
        
        const focusAreasSubsection = subsections.find(
          (s: any) => s.title === 'Focus Areas'
        );
        expect(focusAreasSubsection).toBeDefined();
        if (focusAreasSubsection && focusAreasSubsection.type === 'subsection') {
          expect(focusAreasSubsection.items).toContain('Type safety');
          expect(focusAreasSubsection.items).toContain('Performance optimization');
        }
      }
      
      // Check data section
      expect(compiled.data).toHaveLength(2);

      // 最初はSectionElement
      expect(compiled.data[0]).toEqual({
        type: 'section',
        category: 'data',
        title: 'Current State',
        items: [],
        cacheHint: 'static'
      });

      const dataElement = compiled.data[1];
      if (dataElement.type === 'material') {
        expect(dataElement.id).toBe('code-snippet');
        expect(dataElement.title).toBe('TypeScript Code');
        expect(dataElement.content).toContain('function processData');
      }
      
      // Check output section
      expect(compiled.output).toHaveLength(1);
      const outputSection = compiled.output[0];
      if (outputSection.type === 'section') {
        expect(outputSection.items).toContain('Provide a detailed code review with:');
        
        const reviewStructure = outputSection.items.find(
          item => typeof item === 'object' && 
                  item.type === 'subsection' &&
                  item.title === 'Review Structure'
        );
        expect(reviewStructure).toBeDefined();
      }
      
      // The compiled prompt should be ready for formatting
      expect(compiled).toMatchObject({
        instructions: expect.any(Array),
        data: expect.any(Array),
        output: expect.any(Array)
      });
    });
  });
});