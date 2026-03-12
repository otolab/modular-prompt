import { describe, it, expect } from 'vitest';
import { isAIDriver, resolveDriver } from './driver-input.js';
import type { DriverSet } from './driver-input.js';
import type { AIDriver } from '@modular-prompt/driver';

// モックドライバー作成ヘルパー
function createMockDriver(name: string): AIDriver {
  return {
    query: async () => ({ content: name, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }),
    streamQuery: async () => ({ stream: (async function*() {})(), result: Promise.resolve({ content: name, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 } }) }),
    close: async () => {}
  } as AIDriver;
}

describe('isAIDriver', () => {
  it('AIDriverオブジェクトに対してtrueを返す', () => {
    expect(isAIDriver(createMockDriver('test'))).toBe(true);
  });

  it('DriverSetに対してfalseを返す', () => {
    const set: DriverSet = { default: createMockDriver('default') };
    expect(isAIDriver(set)).toBe(false);
  });

  it('nullに対してfalseを返す', () => {
    expect(isAIDriver(null)).toBe(false);
  });
});

describe('resolveDriver', () => {
  it('AIDriverをそのまま返す', () => {
    const driver = createMockDriver('single');
    expect(resolveDriver(driver, 'thinking')).toBe(driver);
  });

  it('DriverSetから指定された役割のドライバーを返す', () => {
    const defaultDriver = createMockDriver('default');
    const thinkingDriver = createMockDriver('thinking');
    const set: DriverSet = { default: defaultDriver, thinking: thinkingDriver };
    expect(resolveDriver(set, 'thinking')).toBe(thinkingDriver);
  });

  it('DriverSetで未定義の役割はdefaultにフォールバック', () => {
    const defaultDriver = createMockDriver('default');
    const set: DriverSet = { default: defaultDriver };
    expect(resolveDriver(set, 'plan')).toBe(defaultDriver);
  });

  it('roleを省略するとdefaultを返す', () => {
    const defaultDriver = createMockDriver('default');
    const set: DriverSet = { default: defaultDriver, thinking: createMockDriver('thinking') };
    expect(resolveDriver(set)).toBe(defaultDriver);
  });
});
