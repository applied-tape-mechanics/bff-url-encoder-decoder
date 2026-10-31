/**
 * Brainfuck compiler / generator for:
 * 1. URL percent-encoder (bf/url_encode.bf)
 * 2. URL percent-decoder (bf/url_decode.bf)
 *
 * Run `npm run compile:bf` to regenerate both programs.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

type Thunk = () => void;

export class Tape {
  pos: number;
  private readonly ops: string[] = [];

  constructor(pos = 0) {
    this.pos = pos;
  }

  goto(target: number): void {
    const diff = target - this.pos;
    if (diff > 0) this.ops.push('>'.repeat(diff));
    else if (diff < 0) this.ops.push('<'.repeat(-diff));
    this.pos = target;
  }

  add(n = 1): void {
    if (n > 0) this.ops.push('+'.repeat(n));
  }

  sub(n = 1): void {
    if (n > 0) this.ops.push('-'.repeat(n));
  }

  zero(): void {
    this.ops.push('[-]');
  }

  dot(): void {
    this.ops.push('.');
  }

  comma(): void {
    this.ops.push(',');
  }

  loopStart(): void {
    this.ops.push('[');
  }

  loopEnd(): void {
    this.ops.push(']');
  }

  emitChar(asciiVal: number, printCell = 30): void {
    const orig = this.pos;
    this.goto(printCell);
    this.zero();
    this.add(asciiVal);
    this.dot();
    this.zero();
    this.goto(orig);
  }

  emitStr(text: string, printCell = 30): void {
    const orig = this.pos;
    this.goto(printCell);
    let cur = 0;
    for (const b of new TextEncoder().encode(text)) {
      const diff = b - cur;
      if (diff > 0) this.add(diff);
      else if (diff < 0) this.sub(-diff);
      this.dot();
      cur = b;
    }
    this.zero();
    this.goto(orig);
  }

  code(): string {
    return this.ops.join('');
  }
}

export function copyCell(t: Tape, src: number, dst1: number, dst2: number): void {
  t.goto(dst1); t.zero();
  t.goto(dst2); t.zero();
  t.goto(src);
  t.loopStart();
  t.goto(dst1); t.add();
  t.goto(dst2); t.add();
  t.goto(src); t.sub();
  t.loopEnd();
  t.goto(dst2);
  t.loopStart();
  t.goto(src); t.add();
  t.goto(dst2); t.sub();
  t.loopEnd();
  t.goto(0);
}

export function testEqCell(
  t: Tape,
  srcCell: number,
  target: number,
  resCell: number,
  s1 = 24,
  s2 = 25,
): void {
  t.goto(s1); t.zero(); t.goto(s2); t.zero();
  t.goto(srcCell);
  t.loopStart();
  t.goto(s1); t.add();
  t.goto(s2); t.add();
  t.goto(srcCell); t.sub();
  t.loopEnd();
  t.goto(s2);
  t.loopStart();
  t.goto(srcCell); t.add();
  t.goto(s2); t.sub();
  t.loopEnd();
  t.goto(s1);
  if (target > 0) t.sub(target);
  t.goto(resCell); t.zero(); t.add();
  t.goto(s1);
  t.loopStart();
  t.goto(resCell); t.zero();
  t.goto(s1); t.zero();
  t.loopEnd();
  t.goto(0);
}

export function ifElse(
  t: Tape,
  flagCell: number,
  ifFn: Thunk | null,
  elseFn: Thunk | null = null,
  level = 0,
): void {
  const s1 = 12 + level * 2;
  const s2 = 13 + level * 2;
  t.goto(s1); t.zero(); t.goto(s2); t.zero();
  t.goto(flagCell);
  t.loopStart();
  t.goto(s1); t.add();
  t.goto(s2); t.add();
  t.goto(flagCell); t.sub();
  t.loopEnd();
  t.goto(s2);
  t.loopStart();
  t.goto(flagCell); t.add();
  t.goto(s2); t.sub();
  t.loopEnd();

  // s1 has the flag value; s2 will be 1 if else should run
  t.goto(s2); t.zero(); t.add();
  t.goto(s1);
  t.loopStart();
  if (ifFn) ifFn();
  t.goto(s2); t.zero();
  t.goto(s1); t.zero();
  t.loopEnd();

  t.goto(s2);
  t.loopStart();
  if (elseFn) elseFn();
  t.goto(s2); t.zero();
  t.loopEnd();
  t.goto(0);
}

/**
 * Sets resCell = 1 if srcCell <= K else 0 (for 0 <= srcCell <= 255).
 * Uses a fast O(v) countdown:
 *   s1 (26): countdown copy of srcCell
 *   s2 (27): counter (starts at K + 1)
 *   s3 (28): temp flag
 *   s4 (29): scratch
 */
export function testLeConst(t: Tape, srcCell: number, K: number, resCell: number): void {
  const [s1, s2, s3, s4] = [26, 27, 28, 29];
  copyCell(t, srcCell, s1, s4);
  t.goto(resCell); t.zero(); t.add(1); // is_le = 1
  t.goto(s2); t.zero(); t.add(K + 1); // counter = K + 1

  t.goto(s1);
  t.loopStart();
  t.sub(1);

  // if resCell == 1:
  copyCell(t, resCell, s3, s4);
  t.goto(s3);
  t.loopStart();
  t.goto(s2); t.sub(1);
  testEqCell(t, s2, 0, s4, 31, 32);
  t.goto(s4);
  t.loopStart();
  t.goto(resCell); t.zero();
  t.goto(s4); t.zero();
  t.loopEnd();
  t.goto(s3); t.zero();
  t.loopEnd();

  t.goto(s1);
  t.loopEnd();
  t.goto(0);
}

/** Emits `if (is unreserved) set c1 = 1` for the single-character equality tests. */
function markUnreservedIfEq(t: Tape, ascii: number): void {
  testEqCell(t, 0, ascii, 2, 24, 25);
  t.goto(2);
  t.loopStart();
  t.goto(1); t.zero(); t.add();
  t.goto(2); t.zero();
  t.loopEnd();
}

/** Emits `if (c0 - base <= span) set c1 = 1` for the character-range tests. */
function markUnreservedIfInRange(t: Tape, base: number, span: number): void {
  copyCell(t, 0, 24, 25);
  t.goto(24); t.sub(base);
  testLeConst(t, 24, span, 2);
  t.goto(2);
  t.loopStart();
  t.goto(1); t.zero(); t.add();
  t.goto(2); t.zero();
  t.loopEnd();
}

/**
 * Generates the Brainfuck program for URL percent-encoding (RFC 3986).
 * Tape layout:
 *   c0: char_in (and loop condition)      c1: is_unreserved
 *   c2: temp / flag                       c3: div_c0 (copy of c0 for division)
 *   c4: H (high nibble)                   c5: counter (starts at 16)
 *   c6: L (low nibble)                    c7: nibble_to_emit
 *   c8..c11: delimiter / comparison flags c12..c23: if_else scratchpads
 *   c24..c29: comparison & range scratch  c30: print_cell
 */
export function compileUrlEncoder(): string {
  const t = new Tape(0);

  // Clear initial cells
  for (let i = 0; i < 35; i++) {
    t.goto(i); t.zero();
  }
  t.goto(0);

  // Read first char
  t.comma();
  t.loopStart(); // while c0 != 0

  // 1. Determine if c0 is unreserved
  t.goto(1); t.zero(); // is_unreserved = 0

  markUnreservedIfEq(t, 45); // '-'
  markUnreservedIfEq(t, 46); // '.'
  markUnreservedIfEq(t, 95); // '_'
  markUnreservedIfEq(t, 126); // '~'
  markUnreservedIfInRange(t, 48, 9); // '0'..'9'
  markUnreservedIfInRange(t, 65, 25); // 'A'..'Z'
  markUnreservedIfInRange(t, 97, 25); // 'a'..'z'

  const onUnreserved = () => {
    t.goto(0); t.dot();
  };

  const emitNibble = (cell: number) => {
    // If nibble <= 9: emit nibble + 48; else emit nibble + 55
    testLeConst(t, cell, 9, 2);

    const emitDigit = () => {
      copyCell(t, cell, 30, 24);
      t.goto(30); t.add(48); t.dot(); t.zero();
    };
    const emitAlpha = () => {
      copyCell(t, cell, 30, 24);
      t.goto(30); t.add(55); t.dot(); t.zero();
    };
    ifElse(t, 2, emitDigit, emitAlpha, 1);
  };

  const onReserved = () => {
    // Emit '%' (ASCII 37)
    t.emitChar(37, 30);

    // Decompose c0 into H (c4) and L (c6) via countdown counter
    copyCell(t, 0, 3, 24);
    t.goto(4); t.zero(); // H = 0
    t.goto(5); t.zero(); t.add(16); // counter = 16

    // while c3 > 0:
    t.goto(3);
    t.loopStart();
    t.sub(1);
    t.goto(5); t.sub(1); // counter -= 1
    // if counter == 0: H += 1, counter = 16
    testEqCell(t, 5, 0, 2, 24, 25);
    t.goto(2);
    t.loopStart();
    t.goto(4); t.add(1);
    t.goto(5); t.zero(); t.add(16);
    t.goto(2); t.zero();
    t.loopEnd();
    t.goto(3);
    t.loopEnd();

    // L = 16 - counter
    t.goto(6); t.zero(); t.add(16);
    copyCell(t, 5, 24, 25);
    t.goto(24);
    t.loopStart();
    t.goto(6); t.sub(1);
    t.goto(24); t.sub(1);
    t.loopEnd();

    emitNibble(4); // high nibble
    emitNibble(6); // low nibble
  };

  ifElse(t, 1, onUnreserved, onReserved, 0);

  // Read next char
  t.goto(0); t.comma();
  t.loopEnd();

  return t.code();
}

/**
 * Generates the Brainfuck program for URL percent-decoding.
 * Tape layout:
 *   c0: char_in (loop condition)  c1: is_percent (c0 == 37)  c2: is_plus (c0 == 43)
 *   c3: hex1_raw   c4: hex2_raw   c5: H (0..15)   c6: L (0..15)   c7: decoded_byte
 *   c8..c11: flags  c12..c23: if_else scratchpads  c24..c29: comparison scratch  c30: print_cell
 */
export function compileUrlDecoder(): string {
  const t = new Tape(0);

  for (let i = 0; i < 35; i++) {
    t.goto(i); t.zero();
  }
  t.goto(0);

  t.comma();
  t.loopStart();

  // Test '%' (ASCII 37)
  testEqCell(t, 0, 37, 1, 24, 25);

  /** Decodes the hex digit in `rawCell` into `destCell` (0..15). */
  const decodeHex = (rawCell: number, destCell: number) => {
    t.goto(destCell); t.zero();
    copyCell(t, rawCell, 24, 25);
    t.goto(24); t.sub(48);
    testLeConst(t, 24, 9, 8); // '0'..'9'

    const isDigit = () => {
      copyCell(t, rawCell, destCell, 24);
      t.goto(destCell); t.sub(48);
    };

    const checkAlpha = () => {
      // 'A'..'F' (65..70): value = c - 55; otherwise 'a'..'f' (97..102): value = c - 87
      copyCell(t, rawCell, 24, 25);
      t.goto(24); t.sub(65);
      testLeConst(t, 24, 5, 9);

      const isUpper = () => {
        copyCell(t, rawCell, destCell, 24);
        t.goto(destCell); t.sub(55);
      };
      const isLower = () => {
        copyCell(t, rawCell, destCell, 24);
        t.goto(destCell); t.sub(87);
      };
      ifElse(t, 9, isUpper, isLower, 2);
    };

    ifElse(t, 8, isDigit, checkAlpha, 1);
  };

  const onPercent = () => {
    // Read next two characters
    t.goto(3); t.comma();
    t.goto(4); t.comma();

    decodeHex(3, 5); // H
    decodeHex(4, 6); // L

    // decoded_byte (c7) = H * 16 + L
    t.goto(7); t.zero();
    copyCell(t, 5, 24, 25);
    t.goto(24);
    t.loopStart();
    t.goto(7); t.add(16);
    t.goto(24); t.sub(1);
    t.loopEnd();

    copyCell(t, 6, 24, 25);
    t.goto(24);
    t.loopStart();
    t.goto(7); t.add(1);
    t.goto(24); t.sub(1);
    t.loopEnd();

    // Emit decoded byte
    t.goto(7); t.dot();
  };

  const onNotPercent = () => {
    // '+' (ASCII 43) -> emit ' ' (ASCII 32)
    testEqCell(t, 0, 43, 2, 24, 25);
    ifElse(
      t,
      2,
      () => t.emitChar(32, 30),
      () => {
        t.goto(0); t.dot();
      },
      1,
    );
  };

  ifElse(t, 1, onPercent, onNotPercent, 0);

  t.goto(0); t.comma();
  t.loopEnd();

  return t.code();
}

function main(): void {
  const bfDir = new URL('../bf/', import.meta.url);
  mkdirSync(bfDir, { recursive: true });

  for (const [label, file, generate] of [
    ['URL Encoder', 'url_encode.bf', compileUrlEncoder],
    ['URL Decoder', 'url_decode.bf', compileUrlDecoder],
  ] as const) {
    console.log(`Compiling ${label} (${file})...`);
    const code = generate();
    const path = new URL(file, bfDir);
    writeFileSync(path, code, 'utf-8');
    console.log(`Generated ${fileURLToPath(path)} (${code.length.toLocaleString('en-US')} ops)`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
