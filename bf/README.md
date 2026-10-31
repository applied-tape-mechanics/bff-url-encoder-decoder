# Brainfuck URL Percent-Encoder & Percent-Decoder (`bf/`)

This directory contains two pure Brainfuck streaming state machines:
1. `url_encode.bf` (8,517 operations)
2. `url_decode.bf` (7,114 operations)

Both programs read plain text streams from `stdin` and produce converted streams directly on `stdout`.

---

## 1. URL Encoder (`bf/url_encode.bf`)

Implements RFC 3986 URL percent-encoding.
Unreserved characters (`A-Z`, `a-z`, `0-9`, `-`, `_`, `.`, `~`) pass through untouched.
All other characters are decomposed into high and low nibbles and emitted as `%` followed by two uppercase hexadecimal ASCII characters (`%HH`).

### Tape Memory Layout
| Cells | Name | Purpose |
|---|---|---|
| `c0` | `char_in` | Current input byte read from stdin |
| `c1` | `is_unreserved` | Flag: 1 if byte is safe unreserved character |
| `c2` | `flag` | General boolean test result flag |
| `c3` | `div_c0` | Copy of input byte for division/modulo |
| `c4` | `H` | High nibble quotient `(byte / 16)` |
| `c5` | `counter` | Countdown divisor cell (starts at 16) |
| `c6` | `L` | Low nibble remainder `(16 - counter)` |
| `c7` | `nibble_to_emit`| Working nibble value for hex ASCII conversion |
| `c8..c11` | `delim_flags` | Delimiter test flags |
| `c12..c23` | `if_else_scratch`| Level-isolated scratch cells for nested conditionals |
| `c24..c25` | `test_eq_scratch`| Scratch cells for byte equality checks |
| `c26..c29` | `range_scratch` | Scratch cells for O(v) countdown range comparisons |
| `c30` | `print_cell` | Dedicated stdout character emitter |

---

## 2. URL Decoder (`bf/url_decode.bf`)

Parses percent-encoded streams and reconstructs original byte sequences.
When `%` is encountered, reads the two subsequent hex characters, parses their values ($0..15$), and computes `byte = (H * 16) + L`.
Also decodes `+` to space (ASCII 32). Non-escaped bytes pass directly through.

### Tape Memory Layout
| Cells | Name | Purpose |
|---|---|---|
| `c0` | `char_in` | Current input byte read from stdin |
| `c1` | `is_percent` | Flag: equality check for `%` (ASCII 37) |
| `c2` | `is_plus` | Flag: equality check for `+` (ASCII 43) |
| `c3` | `hex1_raw` | First hex ASCII character after `%` |
| `c4` | `hex2_raw` | Second hex ASCII character after `%` |
| `c5` | `H` | Decoded high nibble value (0..15) |
| `c6` | `L` | Decoded low nibble value (0..15) |
| `c7` | `decoded_byte`| Reconstructed byte `(H * 16 + L)` |
| `c8..c11` | `flags` | Scratch flags for digit vs alpha hex conversion |
| `c12..c23` | `if_else_scratch`| Level-isolated scratch cells |
| `c24..c29` | `range_scratch` | Range and equality test cells |
| `c30` | `print_cell` | Dedicated stdout character emitter |

---

## Recompilation

To recompile both `.bf` state machines:
```bash
npm run compile:bf
```
