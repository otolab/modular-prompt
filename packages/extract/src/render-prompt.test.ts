import { describe, it, expect } from 'vitest';
import { inputChunk } from './extract-elements.js';
import { renderExtractPrompt } from './cli/render-prompt.js';
import { CACHE_PREPARE_CUE } from './cli/constants.js';

describe('renderExtractPrompt', () => {
  it('renders full completion prompt without MLX', () => {
    const prompt = renderExtractPrompt(
      {
        materials: [{ title: 'Notes', content: 'Alice met Bob in Paris.' }],
        messages: [{ role: 'user', content: 'Summarize the meeting.' }],
      },
      {
        cue: 'List people mentioned',
        inputs: inputChunk('previous: none'),
      },
    );

    expect(prompt).toContain('与えられた資料から、指定された観点の情報を抽出する');
    expect(prompt).toContain('以下の Prepared Materials');
    expect(prompt).toContain('Alice met Bob in Paris');
    expect(prompt).toContain('以下の Messages');
    expect(prompt).toContain('Summarize the meeting');
    expect(prompt).toContain('以下の Input Data');
    expect(prompt).toContain('previous: none');
    expect(prompt).toContain('以下の出力指示');
    expect(prompt).toContain('List people mentioned');
  });

  it('renders create-time cache prepare prompt', () => {
    const prompt = renderExtractPrompt(
      { materials: [{ title: 'doc.txt', content: 'body text' }] },
      { cue: CACHE_PREPARE_CUE },
    );

    expect(prompt).toContain('body text');
    expect(prompt).toContain(CACHE_PREPARE_CUE);
  });
});
