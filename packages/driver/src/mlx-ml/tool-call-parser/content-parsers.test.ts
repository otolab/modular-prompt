import { describe, it, expect } from 'vitest';
import { jsonParser, gemma4Parser, pythonicParser, xmlParser } from './content-parsers.js';

describe('jsonParser', () => {
  it('should parse standard format', () => {
    const result = jsonParser.parse('{"name": "get_weather", "arguments": {"location": "Tokyo"}}');
    expect(result).toEqual({ name: 'get_weather', arguments: { location: 'Tokyo' } });
  });

  it('should handle "parameters" as alias for "arguments"', () => {
    const result = jsonParser.parse('{"name": "get_weather", "parameters": {"city": "NYC"}}');
    expect(result).toEqual({ name: 'get_weather', arguments: { city: 'NYC' } });
  });

  it('should parse nested function format', () => {
    const result = jsonParser.parse('{"function": {"name": "get_weather", "arguments": {"location": "Tokyo"}}}');
    expect(result).toEqual({ name: 'get_weather', arguments: { location: 'Tokyo' } });
  });

  it('should parse tool wrapping format', () => {
    const result = jsonParser.parse('{"tool": {"name": "search", "arguments": {"q": "test"}}}');
    expect(result).toEqual({ name: 'search', arguments: { q: 'test' } });
  });

  it('should parse arguments as string (OpenAI format)', () => {
    const result = jsonParser.parse('{"name": "get_weather", "arguments": "{\\"location\\": \\"Tokyo\\"}"}');
    expect(result).toEqual({ name: 'get_weather', arguments: { location: 'Tokyo' } });
  });

  it('should parse array of tool calls', () => {
    const result = jsonParser.parse('[{"name": "fn_a", "arguments": {}}, {"name": "fn_b", "arguments": {"x": 1}}]');
    expect(result).toEqual([
      { name: 'fn_a', arguments: {} },
      { name: 'fn_b', arguments: { x: 1 } },
    ]);
  });

  it('should return null for invalid JSON', () => {
    expect(jsonParser.parse('not valid json')).toBeNull();
  });
});

describe('gemma4Parser', () => {
  it('should parse with special quote tokens', () => {
    const result = gemma4Parser.parse('call:get_weather{location:<|"|>東京<|"|>}');
    expect(result).toEqual({ name: 'get_weather', arguments: { location: '東京' } });
  });

  it('should handle multiple parameters', () => {
    const result = gemma4Parser.parse('call:search{query:<|"|>hello world<|"|>,limit:10}');
    expect(result).toEqual({ name: 'search', arguments: { query: 'hello world', limit: 10 } });
  });

  it('should handle boolean and numeric values', () => {
    const result = gemma4Parser.parse('call:calculate{x:42,y:3.14,verbose:true}');
    expect(result).toEqual({ name: 'calculate', arguments: { x: 42, y: 3.14, verbose: true } });
  });

  it('should handle no parameters', () => {
    const result = gemma4Parser.parse('call:get_status{}');
    expect(result).toEqual({ name: 'get_status', arguments: {} });
  });

  it('should return null for non-matching content', () => {
    expect(gemma4Parser.parse('{"name": "test"}')).toBeNull();
  });
});

describe('pythonicParser', () => {
  it('should parse simple function call', () => {
    const result = pythonicParser.parse('[get_weather(location="東京")]');
    expect(result).toEqual({ name: 'get_weather', arguments: { location: '東京' } });
  });

  it('should parse multiple arguments with type coercion', () => {
    const result = pythonicParser.parse('[search(query="hello world", limit=10, verbose=true)]');
    expect(result).toEqual({ name: 'search', arguments: { query: 'hello world', limit: 10, verbose: true } });
  });

  it('should handle numeric and None values', () => {
    const result = pythonicParser.parse('[calculate(x=42, y=3.14, z=None)]');
    expect(result).toEqual({ name: 'calculate', arguments: { x: 42, y: 3.14, z: null } });
  });

  it('should return null for non-matching content', () => {
    expect(pythonicParser.parse('{"name": "test"}')).toBeNull();
  });
});

describe('xmlParser', () => {
  it('should parse qwen3_coder format', () => {
    const result = xmlParser.parse('<function=get_weather><parameter=location>Tokyo</parameter><parameter=unit>celsius</parameter></function>');
    expect(result).toEqual({ name: 'get_weather', arguments: { location: 'Tokyo', unit: 'celsius' } });
  });

  it('should parse qwen3_coder with multiline parameters', () => {
    const result = xmlParser.parse('<function=get_weather>\n<parameter=location>\n東京\n</parameter>\n</function>');
    expect(result).toEqual({ name: 'get_weather', arguments: { location: '東京' } });
  });

  it('should parse hyphenated function name with no parameters', () => {
    const result = xmlParser.parse('<function=mcp__coeiro-operator__operator_status>\n</function>');
    expect(result).toEqual({ name: 'mcp__coeiro-operator__operator_status', arguments: {} });
  });

  it('should parse minimax invoke format', () => {
    const result = xmlParser.parse('<invoke name="get_weather"><parameter name="location">Tokyo</parameter></invoke>');
    expect(result).toEqual({ name: 'get_weather', arguments: { location: 'Tokyo' } });
  });

  it('should parse MiniCPM5 XML format', () => {
    const result = xmlParser.parse('<function name="get_weather"><param name="location">Tokyo</param><param name="date">2024-06-27</param></function>');
    expect(result).toEqual({ name: 'get_weather', arguments: { location: 'Tokyo', date: '2024-06-27' } });
  });

  it('should return null for non-matching content', () => {
    expect(xmlParser.parse('{"name": "test"}')).toBeNull();
  });
});
