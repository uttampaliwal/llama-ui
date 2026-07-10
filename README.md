<p align="center">
  <img src="https://raw.githubusercontent.com/uttam/ModelVerse/main/assets/logo.svg" alt="ModelVerse" width="200"/>
</p>

<h1 align="center">ModelVerse</h1>

<p align="center">
  <strong>Modern Web UI for Local LLM Inference</strong>
</p>

<p align="center">
  <a href="#features">Features</a> •
  <a href="#demo">Demo</a> •
  <a href="#quick-start">Quick Start</a> •
  <a href="#architecture">Architecture</a> •
  <a href="#comparison">Comparison</a> •
  <a href="#faq">FAQ</a>
</p>

---

## Demo

![ModelVerse Demo](docs/demo.gif)

> _A demo GIF showing chat streaming, model switching, theme changes, and the image viewer._

## Screenshots

| Chat View                          | Settings                                   | Model Selection                        |
| ---------------------------------- | ------------------------------------------ | -------------------------------------- |
| ![Chat](docs/screenshots/chat.png) | ![Settings](docs/screenshots/settings.png) | ![Models](docs/screenshots/models.png) |

| Image Viewer                                       | Search                                 | Mobile                                 |
| -------------------------------------------------- | -------------------------------------- | -------------------------------------- |
| ![Image Viewer](docs/screenshots/image-viewer.png) | ![Search](docs/screenshots/search.png) | ![Mobile](docs/screenshots/mobile.png) |

---

## Features

### Core Chat

- **Multi-engine LLM inference** — Switch between 7 backends (`llamacpp`, `ollama`, `lmstudio`, `openai`, `transformers`, `koboldcpp`, `vllm`) at runtime
- **Real-time streaming** — Token-by-token output via Server-Sent Events (SSE)
- **Conversation management** — Create, rename, delete, pin, star, archive conversations with folder organization
- **Message actions** — Copy, edit, delete, regenerate, share individual messages
- **Export** — Conversations as Markdown or JSON (single or batch)
- **Request queue** — Serializes generation so only one runs at a time with cancellation support
- **Rich markdown rendering** — Headings, bold/italic, task lists, tables, callouts, footnotes, spoilers, code blocks with syntax highlighting
- **LaTeX math** — Inline and display math via MathJax
- **Mermaid diagrams** — Render ````mermaid` code blocks inline
- **Thinking extraction** — Parses `<think>` reasoning tags into collapsible blocks with timing info

### Model Management

- **Auto-scanning** — Detects models from 8 sources: LM Studio, Ollama, llama.cpp, GPT4All, Jan, Open WebUI, Transformers cache, custom paths
- **Metadata** — Auto-detected parameters, quantization, architecture, capabilities (vision, reasoning, tools, code), memory requirements, languages
- **GGUF header parsing** — Reads binary model metadata to detect vision/reasoning/tool support
- **Model cards** — Visual selection with capability badges and size display
- **System monitoring** — GPU utilization, RAM usage, tokens/second, context usage with color warnings

### Plugins (6 included)

| Plugin               | Tools                                                   | Description                                                |
| -------------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| **Image Generation** | `generate_image`                                        | Text-to-image (Stable Diffusion / DALL-E / ComfyUI)        |
| **Speech**           | `text_to_speech`, `speech_to_text`                      | TTS (Piper / OpenAI / eSpeak) and STT (Whisper)            |
| **Web Search**       | `web_search`, `fetch_url`                               | DuckDuckGo / Brave / Google search with page fetching      |
| **RAG**              | `ingest_document`, `search_knowledge`, `list_documents` | Document ingestion and keyword search over knowledge bases |
| **Python Execution** | `execute_python`, `run_notebook`                        | Sandboxed Python and Jupyter notebook execution            |
| **Vision**           | `analyze_image`, `ocr_extract`, `describe_chart`        | Image analysis, OCR, chart interpretation                  |

### Profiles

- **7 built-in profiles** — Balanced, GPU, CPU, Fast, Writing, Reasoning, Coding — each with tuned parameters
- **Custom profiles** — Save/load/delete with file-based persistence

### Settings & Customization

- **7 themes** — Dark, Light, OLED, Dracula, Nord, Catppuccin, Gruvbox
- **Generation parameters** — Temperature, Top P, Top K, Repeat Penalty sliders with live values
- **System prompt editor** — Custom system prompts per profile
- **Presets** — Named presets for generation parameters
- **Virtual scrolling** — Handles 1000+ message conversations with zero lag
- **Keyboard shortcuts** — `Ctrl+K` search, `Ctrl+Shift+C` clear, `Ctrl+Shift+N` new chat, `Ctrl+Shift+S` toggle sidebar
- **Touch gestures** — Swipe, pinch-zoom on mobile

### File Attachments

- Images (vision analysis), PDF, DOCX, XLSX, CSV, ZIP, code files, text files
- Lazy-loaded parsing libraries (pdf.js, mammoth, SheetJS, JSZip)
- Auto-detects vision capability before sending images

---

## Quick Start

### Prerequisites

- [Node.js](https://nodejs.org/) 20+ (tested on 22)
- An LLM backend (one of): [llama.cpp](https://github.com/ggerganov/llama.cpp), [Ollama](https://ollama.ai), [LM Studio](https://lmstudio.ai), or an OpenAI-compatible API key
- (Optional) [Git](https://git-scm.com/) for cloning

### Installation

```bash
# Clone the repository
git clone https://github.com/uttam/ModelVerse.git
cd ModelVerse

# Install dependencies
npm install

# Build the project
npm run build

# Start the server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

### Configuration

Edit `settings.json` in the project root to set your default engine and port:

```json
{
  "port": 3000,
  "activeEngine": "llamacpp"
}
```

### Engine Setup

**llama.cpp** — Place `llama-server.exe` (or `llama-server`) in `bin/`. Model `.gguf` files are auto-scanned.

**Ollama** — Run `ollama serve` (default `http://127.0.0.1:11434`). Models are detected automatically.

**LM Studio** — Enable the local API server in LM Studio settings. Default: `http://127.0.0.1:1234`.

**OpenAI** — Set `OPENAI_API_KEY` environment variable or configure in settings.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     Browser (public/)                     │
│                                                           │
│  main.ts ──► chat.ts ─────────────────┐                   │
│    │                                  │                   │
│    ├── sidebar.ts  (conversations)    │  POST /api/chat   │
│    ├── settings.ts (settings modal)   │  (SSE stream)     │
│    ├── models.ts   (model grid)       │                   │
│    ├── server.ts   (start/stop)       ▼                   │
│    ├── conversation.ts (CRUD + virt) ─┼──────────────────┐│
│    ├── markdown.ts / formatter.ts     │                  ││
│    ├── attachments.ts                 │                  ││
│    ├── db.ts       (IndexedDB)        │                  ││
│    └── state.ts    (AppState)         │                  ││
│                                        │                  ││
│  worker.ts (highlight.js web worker)  │                  ││
└────────────────────────────────────────┘                  │
                      │ HTTP / SSE                          │
┌─────────────────────▼────────────────────────────────────┐│
│                 Express.js Server (server.ts)              ││
│                                                            ││
│  ┌──────────┐  ┌────────────┐  ┌──────────────────┐      ││
│  │ Settings │  │ Engines    │  │ Plugins          │      ││
│  │ (Zod)    │  │ Registry   │  │ Manager          │      ││
│  │          │  │ ┌────────┐ │  │ ┌──────────────┐ │      ││
│  │ profiles │  │ │llamacpp│ │  │ │ Web Search   │ │      ││
│  │ config-  │  │ │ollama  │ │  │ │ Image Gen    │ │      ││
│  │ schemas  │  │ │lmstudio│ │  │ │ Speech       │ │      ││
│  │          │  │ │openai  │ │  │ │ RAG          │ │      ││
│  │ model-   │  │ │kobold  │ │  │ │ Python Exec  │ │      ││
│  │ metadata │  │ │vllm    │ │  │ │ Vision       │ │      ││
│  │          │  │ │transf. │ │  │ └──────────────┘ │      ││
│  │ model-   │  │ └────────┘ │  └──────────────────┘      ││
│  │ scanner  │  └────────────┘                            ││
│  └──────────┘                                            ││
│  RequestQueue (serializes generation)                     ││
└───────────────────────────────────────────────────────────┘
```

### Data Flow

1. **Chat** — Client sends `POST /api/chat` with message history → Server enqueues in `RequestQueue` → Calls `engine.generate()` → Streams tokens back via SSE → Client renders tokens in real-time
2. **Model loading** — `POST /api/server/start` with model path → Server spawns binary or connects to remote API → Returns status
3. **Status** — Client polls `GET /api/status` and `GET /api/system` every 3 seconds to update the status bar
4. **Persistence** — Conversations in IndexedDB (browser); profiles, settings, metadata on server filesystem

### Project Structure

```
ModelVerse/
├── server.ts              # Express server entry point
├── src/                   # Server-side source
│   ├── config-schemas.ts  # Zod validation schemas
│   ├── profiles.ts        # Profile management
│   ├── model-metadata.ts  # Metadata CRUD
│   ├── model-scanner.ts   # Filesystem scanner
│   ├── logger.ts          # File-based logging
│   ├── engines/           # 7 LLM backends
│   └── plugins/           # 6 plugins
├── public/                # Client-side (browser)
│   ├── index.html         # Single-page app
│   ├── css/               # 14 stylesheets
│   ├── src/               # 25 TypeScript modules
│   └── vendor/            # Vendored libraries
├── profiles/              # Built-in profiles (JSON)
├── scripts/               # Build/utility scripts
├── tests/                 # Vitest tests
└── .github/workflows/     # CI/CD
```

---

## Comparison

| Feature                  | ModelVerse                                    | Open WebUI               | Ollama Web UI | LM Studio    | Jan        |
| ------------------------ | --------------------------------------------- | ------------------------ | ------------- | ------------ | ---------- |
| **Local-first**          | ✅                                            | ✅                       | ✅            | ✅           | ✅         |
| **Multi-engine**         | 7 engines                                     | Ollama only              | Ollama only   | 1 engine     | 1 engine   |
| **Streaming**            | ✅ SSE                                        | ✅ SSE                   | ✅ SSE        | ✅           | ✅         |
| **Conversation folders** | ✅ Pin, star, archive, folders                | ✅                       | ❌            | ❌           | ❌         |
| **Virtual scrolling**    | ✅ 1000+ msgs                                 | ❌                       | ❌            | ❌           | ❌         |
| **Built-in plugins**     | 6 (search, vision, TTS, RAG, code, image gen) | ✅ Web search, image gen | ❌            | ❌           | ❌         |
| **Python execution**     | ✅ Jupyter notebooks                          | ❌                       | ❌            | ❌           | ❌         |
| **RAG**                  | ✅ Document ingestion + keyword search        | ✅ Full RAG              | ❌            | ❌           | ❌         |
| **Themes**               | 7 themes                                      | Light/Dark               | Light/Dark    | Light/Dark   | Light/Dark |
| **Model scanning**       | 8 sources auto-detect                         | Ollama only              | Ollama only   | 1 folder     | 1 folder   |
| **GGUF metadata**        | ✅ Header parsing                             | ❌                       | ❌            | ❌           | ❌         |
| **Profiles**             | 7 built-in + custom                           | ❌                       | ❌            | Presets only | ❌         |
| **Math rendering**       | ✅ MathJax                                    | ✅                       | ❌            | ❌           | ❌         |
| **Mermaid diagrams**     | ✅                                            | ❌                       | ❌            | ❌           | ❌         |
| **Mobile support**       | ✅ Touch gestures                             | ✅                       | ❌            | ❌           | ❌         |
| **Export**               | Markdown / JSON                               | Markdown                 | Markdown      | ❌           | ❌         |
| **Keyboard shortcuts**   | 6 shortcuts                                   | ❌                       | ❌            | ❌           | ❌         |
| **Open source**          | ✅ MIT                                        | ✅ MIT                   | ✅ MIT        | ❌           | ✅ AGPL    |

---

## Roadmap

### v0.2 — Stability & Polish

- [ ] End-to-end test suite (Playwright)
- [ ] Error boundary UI for engine failures
- [ ] Auto-update checker for new releases
- [ ] Docker image for one-command deploy
- [ ] Windows/Mac/Linux installers

### v0.3 — Intelligence

- [ ] Tool-use support for LLM function calling
- [ ] Multi-turn RAG (chat over documents)
- [ ] Custom plugin SDK / remote plugin API
- [ ] A/B comparison between models
- [ ] Prompt template library

### v0.4 — Collaboration

- [ ] Multi-user with authentication
- [ ] Shared conversation links
- [ ] Collaborative prompt editing
- [ ] Usage analytics dashboard

### v1.0 — Production

- [ ] Plugin marketplace
- [ ] Fine-tuning integrations (LoRA, QLoRA)
- [ ] Multi-modal (image/video generation)
- [ ] WebSocket-based real-time sync

---

## FAQ

### What LLM backends are supported?

7 backends: llama.cpp, Ollama, LM Studio, OpenAI (and compatible), KoboldCpp, vLLM, and Transformers.js. Switch at runtime with no restart needed.

### Can I use cloud models alongside local ones?

Yes. Add OpenAI as an engine and switch freely between local and cloud models.

### How do I add my own model?

Place `.gguf` files in any monitored directory. ModelVerse auto-scans LM Studio, Ollama, llama.cpp, GPT4All, Jan, Open WebUI, Transformers cache, and custom paths.

### Does it support GPU acceleration?

Yes. llama.cpp uses GPU layers configurable via profiles (0 = CPU only, 999 = max offloading). GPU utilization is shown in the status bar.

### Is my data private?

All conversations and settings stay on your machine. Conversations are stored in IndexedDB in the browser; profiles and metadata on the server filesystem. No data is sent to external services unless you configure the OpenAI engine.

### Can I run it on a headless server?

Yes. The server runs without a display. Access the UI from any browser on the network. Set `host` to `0.0.0.0` in settings.

### How do I update?

Pull the latest changes and rebuild: `git pull && npm install && npm run build`.

---

## Known Limitations

- **Single-user** — No multi-user or authentication support yet (planned for v0.4)
- **No built-in model downloads** — You must provide your own models. Auto-download is not yet integrated.
- **RAG is keyword-based** — Current RAG uses keyword search only. Semantic/embedding-based search is planned.
- **Transformers.js engine is a stub** — The Transformers.js backend does not yet perform real inference. Contributions welcome.
- **Ollama model scanning** — Requires Ollama to be running locally for manifest-based detection.
- **WebSocket not yet used for chat** — Chat uses SSE (HTTP streaming) rather than WebSockets. The `ws` dependency is reserved for planned real-time features.
- **No plugin hot-reload** — Plugin enable/disable requires a server restart to fully take effect.
- **Mobile PWA** — Not yet installable as a Progressive Web App. Offline support is limited.
- **llama.cpp binary management** — Binary updates require manual download or the `npm run update-llama` script.

---

## Contributing

We welcome contributions! Please follow these guidelines:

### Getting Started

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Install dependencies: `npm install`
4. Make your changes
5. Run checks: `npm run lint && npm run format && npm run test && npm run typecheck`

### Commit Convention

This project follows [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add model comparison view
fix: handle empty conversation export
docs: update API documentation
refactor: extract queue logic into separate module
```

Commit messages are linted by commitlint on commit.

### Code Style

- **TypeScript** — Strict mode with `noUnusedLocals` and `noUnusedParameters`
- **Formatting** — Prettier (semicolons, single quotes, trailing commas)
- **Linting** — ESLint with `typescript-eslint` (recommended rules)
- All checks are enforced via Husky pre-commit hooks (lint-staged) and CI (GitHub Actions)

### Testing

- **Unit tests** — Vitest (run `npm test`)
- **Type checking** — `npm run typecheck` (dual tsconfig)
- **End-to-end** — Planned (Playwright)

### Pull Request Process

1. Ensure all checks pass locally
2. Update tests if adding/changing functionality
3. Update documentation if changing public APIs
4. Open a PR with a clear title and description

### Development Scripts

```bash
npm run dev          # Build + start server
npm run lint         # ESLint check
npm run lint:fix     # ESLint auto-fix
npm run format       # Prettier check
npm run format:fix   # Prettier auto-format
npm test             # Run tests
npm run typecheck    # TypeScript type check
npm run benchmark    # Run performance benchmark
```

---

## License

[MIT](LICENSE) © Uttam
