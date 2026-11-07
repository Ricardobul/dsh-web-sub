# dsh-web-sub

[![Version](https://img.shields.io/badge/version-0.8.0-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-DeepSeek%20Harness%20(DSH)%20%7C%20OpenCode-purple.svg)](https://github.com/deepseek-ai/dsh)
[![ChatGPT](https://img.shields.io/badge/ChatGPT-Codex%20OAuth%20integrated-10a37f.svg)](https://chatgpt.com)
[![Visual QC](https://img.shields.io/badge/Visual%20QC-watch--skill%20integrated-indigo.svg)](https://github.com/Ricardobul/dsh-web-sub)

**dsh-web-sub** seamlessly bridges your **Gemini**, **ChatGPT**, and **DeepSeek** web subscriptions into [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/dsh) and [OpenCode Desktop](https://opencode.ai) as native models. Enjoy **GPT-5.6 Luna, GPT-6 Luna, GPT-6 Astra, Gemini 4 Argon, Gemini 3.8 Flash**, and **DeepSeek Chat & DeepThink** with zero API key costs, infinite iteration, and automatic session upkeep.

Starting in **v0.8.0**, `dsh-web-sub` introduces:
- **First-Class ChatGPT Subscription Support**: Connects directly to the official ChatGPT Codex subscription backend via OAuth 2.0 PKCE (`~/.codex/auth.json` or `dsh-web-sub login chatgpt`), giving you access to OpenAI's flagship models (`gpt-5.6-luna`, `gpt-6-luna`, `gpt-5.6-sol`, `gpt-6-astra`).
- **Resilient JSON Tool Call Sanitizer**: Automatically cleans and repairs unescaped Windows paths (`D:\...`), invalid JSON escapes, literal linebreaks in arguments, and trailing commas emitted by LLMs, eliminating tool call leaks in chat.
- **Universal Multi-Host Compatibility**: Fully supports both **DeepSeek Harness (DSH)** via Cordis RPC routes and **OpenCode Desktop / Claude Code** via the local OpenAI-compatible bridge on `http://127.0.0.1:18431/v1`.

---

## Key Features

- **Zero-Cost Web Sessions**: Harness consumer web models without paid API keys, credit cards, or token metering.
- **Full Model Lineup**:
  - **ChatGPT**: GPT-5.6 Luna, GPT-6 Luna, GPT-5.6 Sol, GPT-6 Astra, GPT-5.3 Codex Spark (with reasoning and native tool streaming).
  - **Gemini**: Gemini 4 Argon, Gemini 3.8 Flash, Gemini 3.1 Pro (with standard and extended thinking).
  - **DeepSeek**: DeepSeek Web (Chat) and DeepSeek Web (DeepThink reasoning).
- **Bulletproof Tool Execution**:
  - Intercepts synthetic `<tool_call>` tags and raw JSON tool calls.
  - Sanitizes invalid escapes and Windows file paths in shell commands before JSON parsing.
  - Inoculates models against API key hunting and refusal filters.
- **Redesigned Modern UI**:
  - Polished dark glassmorphic card design matching DeepSeek Harness desktop theme.
  - Generic **"Abrir browser"** button for universal browser synchronization.
  - Interactive model badges, real-time bridge indicators, and live status bars.
- **Native Visual QC & Motion Graphics Engine**:
  - Directly exposes `auditar_video` tool and `dsh-web-sub audit` CLI command.
  - Validates Safe-Area compliance (9:16 vertical 880px central column, 16:9 horizontal, 4:5 social).
  - Inspects text collision, safe margins, and video stream integrity.
- **Self-Healing Session Layer**:
  - Automatic PKCE OAuth token refresh for ChatGPT via `auth.openai.com`.
  - Automatically recovers and rotates Google `__Secure-1PSID` / `__Secure-1PSIDTS` cookies and CSRF tokens.
  - Handles client-side WebAssembly Proof-of-Work (PoW) computation for DeepSeek.

---

## Architecture Overview

```
 ┌─────────────────────────────────────────────────────────┐
 │               DeepSeek Harness (DSH) Web UI            │
 └─────────────┬─────────────────────────────▲─────────────┘
               │ HTTP / JSON                 │ SSE Stream
               ▼                             │
 ┌─────────────────────────────────────────────────────────┐
 │         dsh-web-sub Local Bridge (127.0.0.1:18431)       │
 ├─────────────────────────────┬───────────────────────────┤
 │  • OpenAI-Compatible Proxy  │  • Visual QC Engine       │
 │  • Synthetic Tool Invoker   │  • Safe-Area 9:16 Checker │
 │  • Auto PoW (WebAssembly)   │  • watch-skill Runner     │
 └─────────────┬───────────────┴─────────────▲─────────────┘
               │ Web RPC                     │
               ▼                             │
     ┌──────────────────┐          ┌──────────────────┐
     │  chat.deepseek   │          │  gemini.google   │
     │  (Session Web)   │          │  (Argon / Flash) │
     └──────────────────┘          └──────────────────┘
```

---

## Installation

### 1. Place in your DSH profile
Copy the package into your DSH desktop profile's `node_modules`:
```bash
# Windows
C:\Users\<user>\.dsh\profiles\desktop\node_modules\dsh-web-sub

# Linux / macOS
~/.dsh/profiles/desktop/node_modules/dsh-web-sub
```

### 2. Register in `cordis.patch.yml`
Add the plugin row inside your profile's `cordis.patch.yml`:
```yaml
- insert:
    - id: web-subscription
      name: 'dsh-web-sub'
```

### 3. Restart DSH
Launch DeepSeek Harness. The models will appear under **Settings → Models** and the configuration card is available under **Plugins → Web Chat Subscription**.

---

## Account Connection

### One-Click Browser Sync (Recommended)
1. Navigate to **Plugins → Web Chat Subscription**.
2. Click **"Abrir browser"** under the desired provider.
3. Sign in to your account. The plugin automatically detects and stores the session token/cookies securely in `~/.dsh/dsh-web-sub/accounts.json` (`0600` permissions).

### Manual Paste
Expand **"Inserir credenciais manualmente"**:
- **DeepSeek**: Paste `localStorage.userToken` extracted from `chat.deepseek.com`.
- **Gemini**: Paste the `Cookie` header from `gemini.google.com` (specifically `__Secure-1PSID`).

---

## Motion Graphics Visual QC (`auditar_video`)

When creating motion graphics with **Gemini 4 Argon** in DSH (via HyperFrames, Canvas 2D, or Remotion), the model can autonomously audit its output before presenting it:

```json
{
  "name": "auditar_video",
  "arguments": {
    "caminho_video": "renders/take_01.mp4",
    "formato": "9:16",
    "criterios": "Verify 880px safe column and text clearance"
  }
}
```

The plugin analyzes the file and returns a structured QC report:
```json
{
  "ok": true,
  "approved": true,
  "score": 98,
  "aspectRatio": "9:16",
  "safeArea": {
    "columnWidthPx": 880,
    "topMarginPx": 180,
    "bottomMarginPx": 240
  },
  "findings": [
    { "check": "File Integrity", "status": "PASSED" },
    { "check": "Safe-Area Layout", "status": "PASSED", "details": "Content restricted to 880px safe column." },
    { "check": "Readability & Edge Collision", "status": "PASSED" }
  ]
}
```

---

## CLI Reference

The built-in CLI (`dsh-web-sub`) allows full headless management and CI/CD verification:

```bash
# Check status and connected providers
dsh-web-sub status

# Authenticate via browser
dsh-web-sub login deepseek-web
dsh-web-sub login gemini-web

# Inspect available models
dsh-web-sub models gemini-web

# Run automated Visual QC on a video
dsh-web-sub audit take_01.mp4 --ratio 9:16 --safeArea 880

# Check Visual QC engine status (watch-skill)
dsh-web-sub qc

# Run standalone bridge server
dsh-web-sub serve

# End-to-end smoke test
dsh-web-sub chat gemini-web "Write a quick motion graphics plan"
```

---

## Technical Notes

- **Proof-of-Work (PoW)**: DeepSeek requires a cryptographic challenge per message. The included `sha3_wasm_bg.wasm` computes this via Node's native WebAssembly engine without external binaries.
- **Gemini Batchexecute RPC**: Communicates directly through Google's internal `StreamGenerate` protocol. Header limits are raised to `256 KB` (`maxHeaderSize`) to avoid `UND_ERR_HEADERS_OVERFLOW`.
- **Streaming & Tool Calling**: OpenAI message streams are converted into tagged turns (`[SYSTEM INSTRUCTIONS]`, `[USER]`, `[ASSISTANT]`). Synthetic `<tool_call>` tags are intercepted and emitted as native OpenAI streaming `tool_calls`.

---

## Extensible Middleware & Hooks Architecture

`dsh-web-sub` includes a zero-dependency, pluggable middleware engine allowing developers to hook into the request/response pipeline. You can inject custom prompt grounding, integrate local intent routers (such as ONNX classifiers, Ollama, or local SLMs), or build fast-path execution layers without modifying the core repository.

### Creating a Custom Middleware
Place a `middleware.mjs` (or `.js`) file in your data directory (`~/.dsh/dsh-web-sub/middleware.mjs`) or set the `DSH_WEB_SUB_MIDDLEWARE` environment variable:

```javascript
// ~/.dsh/dsh-web-sub/middleware.mjs

/**
 * Intercept and enrich requests before they are sent upstream.
 */
export async function onRequest({ model, messages, tools, stream, body }) {
  // Example: Inject custom project guidance or task constraints
  const lastMessage = messages[messages.length - 1];
  
  // Fast-path: Return an immediate answer or pre-computed tool call
  // if (shouldHandleLocally(lastMessage)) {
  //   return { handled: true, response: { choices: [{ message: { role: 'assistant', content: 'Local response' } }] } };
  // }

  return { messages, tools };
}

/**
 * Post-process completions or tool calls before returning to the client.
 */
export async function onResponse({ model, content, toolCalls, reasoning }) {
  // Example: Audit or log responses
  return { content, toolCalls };
}
```

---

## Universal OpenAI Tool Calling & Agentic Recovery

Starting in **v0.7.3**, `dsh-web-sub` features an enterprise-grade synthetic tool-calling engine designed for coding agents (**OpenCode Desktop**, **DeepSeek Harness**, **Claude Code**, **Cursor**, etc.):

- **Universal Interception**: Intercepts both `<tool_call>` XML blocks and raw JSON function invocations (`{"name": "...", "arguments": ...}`) across both streaming (SSE) and non-streaming requests.
- **Auto-Healing Parser**: Tolerates trailing commas, unescaped whitespace, markdown codeblock wraps, and raw single objects or arrays.
- **Anti-Refusal Inoculation**: Directs web models to operate with local agent tools without hallucinating requirements for external cloud API keys (e.g. `GEMINI_API_KEY`).
- **Error Recovery Loop**: When client agents return execution errors or invalid tool arguments, hints are automatically appended to prompt the model to self-correct rather than giving up with canned refusals.

---

## License

MIT License © 2026 Ricardo & Vity AI Ecosystem.
