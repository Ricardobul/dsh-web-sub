# dsh-web-sub

Bind your **chat.deepseek.com** and **gemini.google.com** web sessions and use
those models inside [DeepSeek Harness](https://github.com/deepseek-ai/dsh) — no
API key, no billing, just the session you already have in the browser.

The plugin runs a small OpenAI-compatible bridge on `127.0.0.1` and registers
two providers in `llm-pi-ai`, so the models show up in DSH's model picker like
any other provider.

## What it registers

| Provider | Credential slot | Models |
| --- | --- | --- |
| `deepseek-web` | `WEB_DEEPSEEK_TOKEN` | `deepseek-web-chat`, `deepseek-web-think` |
| `gemini-web` | `WEB_GEMINI_COOKIE` | `gemini-web`, `gemini-web-think` |

Bridge: `http://127.0.0.1:18431/v1` (falls forward if the port is busy).

## Install

1. Put this package in your profile's `node_modules`:

   ```
   <profile>/node_modules/dsh-web-sub
   ```

2. Add the row to the profile's `cordis.patch.yml`:

   ```yaml
   - insert:
       - id: web-subscription
         name: 'dsh-web-sub'
   ```

3. Restart DSH. The providers appear under **Settings → Models**.

## Connect an account

**One-click (browser capture).** *Settings → Plugins → Web Chat Subscription →
Connect with browser*. Edge/Chrome opens with a dedicated profile; sign in
normally and the plugin captures the session the moment it exists. Nothing is
injected into the page, and the credentials are only ever typed into the real
site.

**Manual paste.** Expand *Paste credentials manually*:

- **DeepSeek** — `localStorage.userToken` from `chat.deepseek.com`
  (DevTools → Application → Local Storage).
- **Gemini** — the full `Cookie` request header from a `gemini.google.com`
  request; `__Secure-1PSID` is the one that matters.

Credentials land in `~/.dsh/dsh-web-sub/accounts.json` with `0600` on the file
and `0700` on the directory.

## How it works

- **DeepSeek** — every completion is preceded by a fresh Proof-of-Work
  challenge. The answer is computed by DeepSeek's own `sha3_wasm_bg.wasm`
  through Node's built-in WebAssembly, so no `wasmtime`, Python or native module
  is needed. The SSE stream is JSON-Patch flavoured: fragment types (`THINK` vs
  `RESPONSE`) decide reasoning vs content, and `FINISHED` is filtered out.
- **Gemini** — there is no public API for consumer accounts, so the plugin
  speaks the same internal RPC the web app speaks (`StreamGenerate`), scraping
  `SNlM0e` / `cfb2h` / `FdrFJe` from the app page first. Every candidate frame
  carries the full text, so deltas are computed by prefix comparison.

## CLI

```
dsh-web-sub status
dsh-web-sub login deepseek-web
dsh-web-sub login gemini-web
dsh-web-sub set deepseek-web --token <jwt> [--cookie "<header>"]
dsh-web-sub set gemini-web --cookie "<header>"
dsh-web-sub check deepseek-web
dsh-web-sub unbind deepseek-web
dsh-web-sub serve
dsh-web-sub chat deepseek-web-chat "hello"
```

`chat` is the end-to-end smoke test: it starts the bridge, sends one message and
streams the answer back.

## Notes and limits

- These are **web sessions**, not an API. They can expire, rate-limit, or
  change shape; the plugin reports the upstream message instead of pretending
  the turn succeeded. Re-run `login` to refresh.
- Web chat is a single-prompt API, so an OpenAI message array is flattened into
  one prompt with `[SYSTEM INSTRUCTIONS]` / `[USER]` / `[ASSISTANT]` labels.
  Tool calling is supported via synthetic `<tool_call>` prompt formatting and
  streaming response interception, allowing DSH agent tools (running terminal
  commands, reading/writing files) to work seamlessly with web models.
- Use it with your own account, and mind the site's terms.

## Tests

```
node tests/selftest.mjs    # PoW vector, prompt flattening, bridge, store
node tests/host-smoke.mjs  # loads the plugin the way Cordis does
```

The PoW test uses a real challenge/answer pair, so a passing run proves the WASM
path end to end.

## Licence

MIT.
