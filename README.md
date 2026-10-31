# Brainfuck URL Percent-Encoder & Decoder (`bff-url-encoder-decoder`)

> **[Applied Tape Mechanics](https://github.com/applied-tape-mechanics)** — *Empirical computation and discrete field dynamics on minimal linear substrates.*
> *Enterprise-grade cloud microservices—except the core business logic is pure Brainfuck. Best Friends Forever (`BFF`) with the most hostile programming language ever created.*

A bidirectional RFC 3986 **URL percent-encoder** and **percent-decoder** where character classification, hexadecimal nibble division, and `%HH` escape reconstruction are implemented as streaming state machines in **pure Brainfuck** ([`bf/url_encode.bf`](bf/url_encode.bf) and [`bf/url_decode.bf`](bf/url_decode.bf)), served by a TypeScript [Fastify](https://fastify.dev) REST API with OpenAPI/Swagger documentation, an interactive Web UI, and Docker containerization.

---

## 📦 Repository Structure & File Reference

```text
bff-url-encoder-decoder/
├── bf/
│   ├── url_encode.bf          # Pure Brainfuck RFC 3986 percent-encoder state machine (8,517 ops)
│   ├── url_decode.bf          # Pure Brainfuck URL percent-decoder state machine (7,114 ops)
│   └── README.md              # Detailed tape cell allocation & state machine specification
├── src/
│   ├── server.ts              # HTTP server entry point (reads PORT & DISABLE_BACKEND)
│   ├── app.ts                 # Fastify application, OpenAPI/Swagger routes & HTML template injection
│   ├── engine.ts              # Brainfuck VM wrapper executing url_encode.bf and url_decode.bf
│   ├── compiler.ts            # Deterministic compiler that generates bf/url_encode.bf & bf/url_decode.bf
│   └── index.html             # Interactive Web UI with live Client JS VM fallback
├── test/
│   └── url.test.ts            # 36 automated tests (Brainfuck engines, compiler determinism, round-trips & HTTP API)
├── Dockerfile                 # Multi-stage Node 24 container (base, test, and production stages)
├── docker-compose.yml         # Production service, Brainfuck healthcheck sidecar & isolated test runner
├── package.json               # Service metadata, scripts & pinned bff-interpreter dependency
├── tsconfig.json              # TypeScript configuration
└── LICENSE                    # MIT License
```

---

## ✨ Features

- **Bidirectional Brainfuck Core (`bf/`)**:
  - `bf/url_encode.bf` (`8,517` instructions): Evaluates input bytes against RFC 3986 unreserved character sets (`A-Z`, `a-z`, `0-9`, `-`, `_`, `.`, `~`). Unreserved characters pass through untouched; reserved and multi-byte UTF-8 characters are mathematically decomposed into high and low 4-bit nibbles (`byte / 16` and `byte % 16`) and emitted as `%` followed by two uppercase hexadecimal ASCII characters (`%HH`).
  - `bf/url_decode.bf` (`7,114` instructions): Detects `%` escapes, parses the subsequent two hexadecimal characters (`0-9`, `A-F`, `a-f`), computes `(H * 16) + L` on the tape, and emits the reconstructed byte (plus form `+` → space decoding).
- **Deterministic Compiler (`src/compiler.ts`)**:
  - Generates verified Brainfuck programs using relative pointer tracking (`Tape`) and countdown range algorithms.
- **Fastify REST API** (OpenAPI spec at `/openapi.json`, Swagger UI at `/docs`):
  - `POST /encode`: Percent-encodes text string or URL query parameters.
  - `POST /decode`: Decodes percent-encoded string.
  - `POST /process`: Auto-detects whether the input contains percent escapes (`%HH`) or requires encoding.
  - `GET /bf`: Returns metadata, operation counts, and source code for both Brainfuck engines.
  - `GET /bf/encode`: Returns raw Brainfuck source code for the URL encoder.
  - `GET /bf/decode`: Returns raw Brainfuck source code for the URL decoder.
  - `GET /health`: Health status endpoint.
  - `GET /`: Interactive Web UI.
- **Zero-Submodule Runtime UI & Client-Side Fallback**:
  - Loads [`bff-ui`](https://github.com/applied-tape-mechanics/bff-ui) and [`bff-interpreter`](https://github.com/applied-tape-mechanics/bff-interpreter) at runtime from pinned GitHub releases via jsDelivr CDN (`@v1.0.0`).
  - Works seamlessly both against the Fastify REST API **and** as a 100% standalone static web app on GitHub Pages (`DISABLE_BACKEND=true`).

---

## 🧠 Brainfuck Tape Architecture

See [`bf/README.md`](bf/README.md) for the complete cell-by-cell specification.

### URL Encoder Tape (`bf/url_encode.bf`)
| Cells | Identifier | Purpose |
| :---: | :--- | :--- |
| `c0` | `char_in` | Current input byte read from `stdin` |
| `c1` | `is_unreserved` | Flag: `1` if byte is a safe RFC 3986 unreserved character |
| `c2` | `flag` | General boolean test result flag |
| `c3` | `div_c0` | Copy of input byte for division/modulo by 16 |
| `c4` | `H` | High nibble quotient (`byte / 16`) |
| `c5` | `counter` | Countdown divisor cell (starts at 16) |
| `c6` | `L` | Low nibble remainder (`16 - counter`) |
| `c7` | `nibble_to_emit` | Working nibble value for hex ASCII conversion |
| `c8..c29` | `scratch` | Level-isolated conditional, equality, and range comparison scratch cells |
| `c30` | `print_cell` | Dedicated `stdout` character emitter |

---

## 🐳 Docker Setup (Zero Host Dependencies)

A pre-built production image is published automatically to **GitHub Container Registry (`ghcr.io`)**:

```bash
# Run the microservice directly from GHCR on http://localhost:8017
docker run --rm -p 8017:8000 ghcr.io/applied-tape-mechanics/bff-url-encoder-decoder:latest
```

### Using Docker Compose (Development, Testing & Production)

You don't need Node.js installed on your host machine to test, typecheck, recompile the `.bf` files, or run the server:

```bash
# Run the full 36-test suite (VM, compiler determinism, round-trips & HTTP API) inside Docker
docker compose run --rm test

# Run TypeScript type checking inside Docker
docker compose run --rm test npm run typecheck

# Recompile bf/url_encode.bf and bf/url_decode.bf inside Docker
docker compose run --rm test npm run compile:bf

# Pull and start pre-built release images (service + Brainfuck healthcheck sidecar) from GHCR
docker compose pull
docker compose up -d

# Or build locally from source and start in the background
docker compose up -d --build

# Check container health status
docker compose ps
```

Visit:
- **Interactive Web UI:** [http://localhost:8017](http://localhost:8017)
- **Swagger OpenAPI Docs:** [http://localhost:8017/docs](http://localhost:8017/docs)
- **Brainfuck Healthcheck Sidecar:** [http://localhost:8084](http://localhost:8084)

---

## 💻 Local Development (Node.js ≥ 22.18)

```bash
npm install
npm run dev          # watch mode on http://localhost:8000
npm test             # node:test (engine, compiler output, HTTP API)
npm run typecheck    # tsc --noEmit
npm run compile:bf   # regenerate bf/url_encode.bf and bf/url_decode.bf
```

Set `DISABLE_BACKEND=true` to disable backend API processing and exercise the client-side JavaScript VM only.

---

## 📡 API Examples

### 1. URL Encode (`POST /encode`)
```bash
curl -X POST http://localhost:8017/encode \
  -H "Content-Type: application/json" \
  -d '{"text": "https://example.com/search?q=hello world&lang=en"}'
```

**Response:**
```json
{
  "direction": "encode",
  "source": "https://example.com/search?q=hello world&lang=en",
  "result": "https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Dhello%20world%26lang%3Den",
  "escaped_count": 9,
  "character_count": 48
}
```

### 2. URL Decode (`POST /decode`)
```bash
curl -X POST http://localhost:8017/decode \
  -H "Content-Type: application/json" \
  -d '{"text": "https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Dhello%20world%26lang%3Den"}'
```

**Response:**
```json
{
  "direction": "decode",
  "source": "https%3A%2F%2Fexample.com%2Fsearch%3Fq%3Dhello%20world%26lang%3Den",
  "result": "https://example.com/search?q=hello world&lang=en",
  "escaped_count": 9,
  "character_count": 64
}
```

### 3. Auto-Detect Direction (`POST /process`)
```bash
curl -X POST http://localhost:8017/process \
  -H "Content-Type: application/json" \
  -d '{"text": "price=$100 & fee=5%"}'
```

### 4. Inspect Brainfuck Code & Instruction Breakdown (`GET /bf`)
```bash
# Get instruction breakdown and program statistics
curl "http://localhost:8017/bf?include_code=false"

# Fetch raw Brainfuck source code
curl http://localhost:8017/bf/encode
curl http://localhost:8017/bf/decode
```
