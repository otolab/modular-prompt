/**
 * TypeScript configuration test file
 */

export default {
  models: {
    'test-model-ts': {
      model: 'test-model-ts',
      provider: 'test',
      capabilities: ['test'],
    },
  },
  drivers: {
    test: {},
  },
  evaluation: {
    enabled: false,
  },
  modules: [
    {
      name: 'test-module-ts',
      path: './test-module.ts',
      description: 'Test module from TypeScript config',
    },
  ],
  testCases: [
    {
      name: 'Test Case from TS',
      description: 'TypeScript config test case',
      input: {
        query: 'ts input',
        options: { test: true },
      },
    },
  ],
  evaluators: [],
};
