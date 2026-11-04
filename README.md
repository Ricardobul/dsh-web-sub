# dsh-web-sub

[![Version](https://img.shields.io/badge/version-0.6.1-blue.svg)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-DeepSeek%20Harness%20(DSH)-purple.svg)](https://github.com/deepseek-ai/dsh)
[![Visual QC](https://img.shields.io/badge/Visual%20QC-watch--skill%20integrated-indigo.svg)](https://github.com/Ricardobul/dsh-web-sub)

**dsh-web-sub** seamlessly bridges your **chat.deepseek.com** and **gemini.google.com** web sessions into [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/dsh) as native models. Enjoy **Gemini 4 Argon, Gemini 3.8 Flash, Gemini 3.1 Pro**, and **DeepSeek Chat & DeepThink** with zero API key costs, infinite iteration, and automatic session upkeep.

Starting in **v0.6.0**, `dsh-web-sub` incorporates a **Native Visual Quality Control (QC) & Motion Graphics Audit Engine** (powered by `watch-skill` and geometry heuristics), giving web models the power to automatically audit rendered video clips, enforce Safe-Area boundaries (9:16 vertical / 16:9 horizontal), detect text overflow, and guarantee broadcast polish.

---

## Key Features

- **Zero-Cost Web Sessions**: Harness consumer web models without paid API keys, credit cards, or token metering.
- **Full Model Lineup**:
  - **Gemini**: Gemini 4 Argon, Gemini 3.8 Flash, Gemini 3.1 Pro (with standard and extended thinking).
  - **DeepSeek**: DeepSeek Web (Chat) and DeepSeek Web (DeepThink reasoning).
- **Redesigned Modern UI (v0.6.0)**:
  - Polished dark glassmorphic card design matching DeepSeek Harness desktop theme.
  - Generic **"Abrir browser"** button for universal browser synchronization.
  - Interactive model badges, real-time bridge indicators, and live status bars.
- **Native Visual QC & Motion Graphics Engine**:
  - Directly exposes `auditar_video` tool and `dsh-web-sub audit` CLI command.
  - Validates Safe-Area compliance (9:16 vertical 880px central column, 16:9 horizontal, 4:5 social).
  - Inspects text collision, safe margins, and video stream integrity.
- **Self-Healing Session Layer**:
  - Automatically recovers and rotates Google `__Secure-1PSID` / `__Secure-1PSIDTS` cookies and CSRF tokens.
  - Handles client-side WebAssembly Proof-of-Work (PoW) computation for DeepSeek.
  - Fast-path tool call interception with immediate `</tool_call>` abort to eliminate upstream idling.

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

## License

MIT License © 2026 Ricardo & Vity AI Ecosystem.
