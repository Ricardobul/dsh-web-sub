# dsh-web-sub

[![Version](https://img.shields.io/badge/version-0.8.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-OpenCode%20%7C%20DSH%20%7C%20Cursor%20%7C%20Claude%20Code-purple.svg)](https://github.com/deepseek-ai/dsh)
[![ChatGPT](https://img.shields.io/badge/ChatGPT-Codex%20OAuth%20integrated-10a37f.svg)](https://chatgpt.com)
[![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI%20Compatible%20Bridge-darkgreen.svg)](http://127.0.0.1:18431/v1)

**dsh-web-sub** is a lightweight local bridge and plugin that connects your **Gemini**, **ChatGPT**, and **DeepSeek** web subscriptions directly into your local coding environments, IDEs, and AI agents as native models.

Access **GPT-5.6 Luna, GPT-6 Luna, GPT-6 Astra, Gemini 4 Argon, Gemini 3.8 Flash**, and **DeepSeek Chat & DeepThink (R1)** with **zero paid API key costs**, unlimited iteration, and automatic session upkeep.

---

## Where Can It Be Used? (Supported Environments)

`dsh-web-sub` runs a standard, local OpenAI-compatible HTTP server on `http://127.0.0.1:18431/v1` and integrates with:

1. **OpenCode Desktop & OpenCode CLI**:
   - Point your OpenCode configuration to `http://127.0.0.1:18431/v1` using provider `openai` or custom bridge.
   - Run autonomous multi-turn coding agent loops.

2. **DeepSeek Harness (DSH)**:
   - Native integration via Cordis patch. Configure models directly in **Settings → Models** and manage sessions in **Plugins → Web Chat Subscription**.

3. **VS Code AI Extensions & Coding Agents**:
   - **Claude Code**: Set OpenAI base URL to `http://127.0.0.1:18431/v1`.
   - **Cline / Roo Code**: Add an OpenAI-compatible provider with base URL `http://127.0.0.1:18431/v1`.
   - **Cursor**: Configure Custom OpenAI Provider endpoint with URL `http://127.0.0.1:18431/v1`.
   - **Continue.dev**: Add an OpenAI provider entry in `config.json`.
   - **Windsurf / Aider**: Direct API target for automated refactoring.

4. **Self-Hosted Chat Interfaces**:
   - Compatible with **LibreChat**, **Chatbox**, **NextChat**, and **Open WebUI** for general technical inquiry and pair programming.

---

## What Is It Used For? (Ideal Use Cases)

`dsh-web-sub` is specifically engineered for **software development, code automation, and technical workflows**:

* **Full-Stack Software Development**:
  - Writing, refactoring, and reviewing code in TypeScript, JavaScript, Python, Go, Rust, C++, Java, PHP, and SQL.
  - Designing RESTful APIs, GraphQL schemas, database migrations, and microservices.
  - Generating frontend components (React, Vue, Svelte, Tailwind CSS).

* **Autonomous Coding Agent Workflows**:
  - Multi-turn file reading, editing, and directory exploration.
  - Running unit tests, reading terminal outputs, and automatically self-healing failing test suites.
  - Generating documentation, changelogs, and READMEs directly from codebases.

* **Deep Algorithmic & Mathematical Reasoning**:
  - Complex architectural problem solving with **DeepSeek DeepThink (R1)** and **Gemini Extended Thinking**.
  - Debugging concurrency issues, race conditions, memory leaks, and complex logic puzzles.

* **DevOps & Scripting**:
  - Writing shell scripts (Bash, PowerShell), Dockerfiles, and CI/CD workflows (GitHub Actions, GitLab CI).
  - Infrastructure configuration (Terraform, Kubernetes YAML, Nginx configs).

* **Zero Token Cost Pair Programming**:
  - Eliminate API billing anxiety during long refactoring sessions or exploratory programming by utilizing your existing consumer web subscriptions.

---

## Key Features

- **Zero-Cost Web Sessions**: Harness consumer web models without pay-per-token API metering.
- **Full Model Lineup**:
  - **ChatGPT**: GPT-5.6 Luna, GPT-6 Luna, GPT-5.6 Sol, GPT-6 Astra, GPT-5.3 Codex Spark (with reasoning and native tool streaming).
  - **Gemini**: Gemini 4 Argon, Gemini 3.8 Flash, Gemini 3.1 Pro (with standard and extended thinking).
  - **DeepSeek**: DeepSeek Web (Chat) and DeepSeek Web (DeepThink reasoning).
- **Bulletproof Tool Execution Engine**:
  - Intercepts synthetic `<tool_call>` tags and raw JSON tool calls.
  - **Auto-Healing JSON Parser**: Sanitizes unescaped Windows file paths (`D:\...`), invalid escape characters, trailing commas, and raw line breaks in code arguments.
  - **Auto-Normalizing Tool Arguments**: Automatically adapts flat operation parameters into expected nested container structures.
  - **Sandboxed Code Support**: Maps and repairs JavaScript/Python `code` parameters for agentic code-runners.
- **Self-Healing Session Layer**:
  - Automatic PKCE OAuth token refresh for ChatGPT via `auth.openai.com`.
  - Automatically recovers and rotates Google `__Secure-1PSID` / `__Secure-1PSIDTS` cookies and CSRF tokens.
  - Handles client-side WebAssembly Proof-of-Work (PoW) computation for DeepSeek.
- **Compact Context Management**:
  - Intelligently compacts older tool outputs and past turn code blocks to keep conversations within web session boundaries and prevent session rejection.

---

## Quick Start & Installation

### Option A: OpenCode / Cursor / Cline / Claude Code (Standalone Bridge)

1. Start the local bridge server:
```bash
npx dsh-web-sub serve
# or if installed globally:
dsh-web-sub serve
```
The bridge listens on `http://127.0.0.1:18431/v1`.

2. Login to your providers:
```bash
# Login via browser synchronization
dsh-web-sub login gemini-web
dsh-web-sub login deepseek-web
dsh-web-sub login chatgpt
```

3. In your coding tool (OpenCode, Cline, Cursor), set:
- **Base URL**: `http://127.0.0.1:18431/v1`
- **API Key**: `any-key` (the bridge validates via your local authenticated session)
- **Model**: e.g., `gemini-4-argon`, `gpt-5.6-luna`, or `deepseek-chat`

---

### Option B: DeepSeek Harness (DSH Desktop)

1. Place the package into your DSH desktop profile:
```bash
# Windows
C:\Users\<user>\.dsh\profiles\desktop\node_modules\dsh-web-sub

# Linux / macOS
~/.dsh/profiles/desktop/node_modules/dsh-web-sub
```

2. Add to `cordis.patch.yml`:
```yaml
- insert:
    - id: web-subscription
      name: 'dsh-web-sub'
```

3. Restart DSH. Manage models in **Settings → Models** and sign in via **Plugins → Web Chat Subscription**.

---

## CLI Reference

The built-in CLI (`dsh-web-sub`) allows full headless management and scripting:

```bash
# Check status and connected providers
dsh-web-sub status

# Authenticate via browser
dsh-web-sub login deepseek-web
dsh-web-sub login gemini-web
dsh-web-sub login chatgpt

# Inspect available models
dsh-web-sub models gemini-web
dsh-web-sub models chatgpt

# Run standalone bridge server (for OpenCode / Cline / Cursor)
dsh-web-sub serve

# End-to-end smoke test
dsh-web-sub chat gemini-web "Write a TypeScript function to debounce an async callback"
```

---

## Architecture Overview

```
 ┌─────────────────────────────────────────────────────────────────┐
 │   Coding Environments & Agents (OpenCode, DSH, Cline, Cursor)  │
 └───────────────────────────────┬─────────────────────────────────┘
                                 │ HTTP / JSON & SSE Stream
                                 ▼
 ┌─────────────────────────────────────────────────────────────────┐
 │            dsh-web-sub Local Bridge (127.0.0.1:18431)           │
 ├───────────────────────────────┬─────────────────────────────────┤
 │ • OpenAI-Compatible /v1 API   │ • Auto-Healing JSON Tool Parser │
 │ • PKCE OAuth & Session Kept   │ • WebAssembly PoW Solver (SHA3) │
 └───────┬───────────────────────┴─────────────────┬───────────────┘
         │ Web Session Protocol                    │ Web Session Protocol
         ▼                                         ▼
 ┌───────────────────────────────┐         ┌───────────────────────┐
 │        chat.deepseek.com      │         │    gemini.google.com  │
 │  (DeepSeek Chat & DeepThink)  │         │   (Argon / Flash API) │
 └───────────────────────────────┘         └───────────────────────┘
```

---

## Extensible Middleware & Hooks

`dsh-web-sub` includes a zero-dependency middleware engine allowing developers to hook into the request/response pipeline. You can inject custom prompt grounding, integrate local intent routers (such as ONNX classifiers, Ollama, or local SLMs), or build fast-path execution layers:

```javascript
// ~/.dsh/dsh-web-sub/middleware.mjs

export async function onRequest({ model, messages, tools, stream, body }) {
  // Inject project-specific coding guidelines or instructions
  return { messages, tools };
}

export async function onResponse({ model, content, toolCalls, reasoning }) {
  return { content, toolCalls };
}
```

---

## License

MIT License © 2026 Ricardo & Vity AI Ecosystem.
