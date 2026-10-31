/**
 * Brainfuck URL percent-encoder and percent-decoder engine.
 * Executes pure Brainfuck streaming state machines for URL encoding and decoding.
 */

import { readFileSync } from 'node:fs';
import { BrainfuckVM, cleanCode, compile, type Program } from 'bff-interpreter';

export interface UrlProcessResult {
  direction: 'encode' | 'decode';
  source: string;
  result: string;
  escaped_count: number;
  character_count: number;
}

export interface BfProgramInfo {
  name: string;
  description: string;
  length: number;
  op_counts: Record<string, number>;
  code?: string;
}

const BF_OPS = '><+-.,[]';
const decoder = new TextDecoder();

function loadBf(dir: URL, file: string): string {
  const path = new URL(file, dir);
  try {
    return cleanCode(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`Missing Brainfuck program at ${path.pathname}`, { cause: err });
  }
}

/** Number of Unicode code points (matches what users perceive as "characters"). */
function codePointLength(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

export class UrlEngine {
  readonly codeEncode: string;
  readonly codeDecode: string;
  private readonly programEncode: Program;
  private readonly programDecode: Program;

  constructor(bfDir: URL = new URL('../bf/', import.meta.url)) {
    this.codeEncode = loadBf(bfDir, 'url_encode.bf');
    this.codeDecode = loadBf(bfDir, 'url_decode.bf');
    this.programEncode = compile(this.codeEncode);
    this.programDecode = compile(this.codeDecode);
  }

  /** Metadata, instruction counts and (optionally) source of both Brainfuck engines. */
  getBfInfo(includeCode = true): { url_encode: BfProgramInfo; url_decode: BfProgramInfo } {
    const analyze = (code: string, name: string, description: string): BfProgramInfo => {
      const op_counts: Record<string, number> = {};
      for (const op of BF_OPS) op_counts[op] = code.split(op).length - 1;
      const info: BfProgramInfo = { name, description, length: code.length, op_counts };
      if (includeCode) info.code = code;
      return info;
    };
    return {
      url_encode: analyze(this.codeEncode, 'url_encode.bf', 'RFC 3986 URL percent-encoder streaming state machine'),
      url_decode: analyze(this.codeDecode, 'url_decode.bf', 'RFC 3986 URL percent-decoder streaming state machine'),
    };
  }

  private run(program: Program, text: string): string {
    return decoder.decode(new BrainfuckVM().run(program, text));
  }

  /** Encodes plain text into a percent-encoded URL string using Brainfuck. */
  encode(text: string): UrlProcessResult {
    if (!text) return { direction: 'encode', source: '', result: '', escaped_count: 0, character_count: 0 };
    const result = this.run(this.programEncode, text);
    return {
      direction: 'encode',
      source: text,
      result,
      escaped_count: result.split('%').length - 1,
      character_count: codePointLength(text),
    };
  }

  /** Decodes a percent-encoded URL string into plain text using Brainfuck. */
  decode(text: string): UrlProcessResult {
    if (!text) return { direction: 'decode', source: '', result: '', escaped_count: 0, character_count: 0 };
    const result = this.run(this.programDecode, text);
    return {
      direction: 'decode',
      source: text,
      result,
      escaped_count: text.split('%').length - 1,
      character_count: codePointLength(text),
    };
  }

  /** Auto-detects direction when `direction` is "auto" or unspecified. */
  autoProcess(text: string, direction?: string | null): UrlProcessResult {
    let dir = (direction ?? 'auto').toLowerCase();
    if (dir === 'auto') dir = text.includes('%') ? 'decode' : 'encode';

    if (['encode', 'enc', 'urlencode'].includes(dir)) return this.encode(text);
    if (['decode', 'dec', 'urldecode'].includes(dir)) return this.decode(text);
    throw new Error(`Unsupported direction: ${direction}`);
  }
}
