# Installing dsh-web-sub into a DSH profile

## 1. Copy the package

A DSH profile loads plugins from its own `node_modules`. Copy the built package
there:

```powershell
$profile = "$env:USERPROFILE\.dsh\profiles\desktop"
Copy-Item ".\*" "$profile\node_modules\dsh-web-sub" -Recurse -Force
```

What must exist inside the package folder:

```
package.json
cordis.patch.yml
lib/index.js            # host half (Cordis plugin)
lib/client.js           # settings panel bundle
lib/server.js           # local OpenAI-compatible bridge
lib/store.js            # account store
lib/pow.js              # PoW solver
lib/providers/*.js      # deepseek.js, gemini.js
assets/sha3_wasm_bg.wasm
locale/en.json
locale/pt.json
```

If `assets/sha3_wasm_bg.wasm` is missing, DeepSeek completions fail at the PoW
step. The solver also accepts `assets/sha3_wasm_bg.wasm.b64` (base64 text) as a
fallback, which is handy when a channel cannot carry binary files.

## 2. Mount it in the profile patch

In `<profile>/cordis.patch.yml`:

```yaml
- insert:
    - id: web-subscription
      name: 'dsh-web-sub'
```

`id` is yours to choose (use it to override the row later); `name` must stay the
package name so Cordis can resolve the module.

## 3. Restart DSH

The plugin boots with the profile, so a restart is required. After it comes up:

- `http://127.0.0.1:18431/health` answers `{"ok":true,...}`,
- the DSH log shows `[dsh-web-sub] bridge listening on ...`,
- two new providers appear in the model picker.

If the port is busy the bridge walks forward through `18431..18450`; the exact
port is written into the provider `baseURL` at registration time.

## 4. Bind an account

Use the panel (**Settings → Plugins → Web Chat Subscription**) or the CLI:

```powershell
node node_modules\dsh-web-sub\bin\dsh-web-sub.mjs login deepseek-web
```

## 5. Thinking level

Every published model declares two levels through `reasoningEfforts`, so the
composer's model picker offers **low** and **high**:

| Level | Gemini (`inner[80]` / header flag) | DeepSeek |
| --- | --- | --- |
| low | standard (`1`) | normal chat |
| high | extended thinking (`2`) | DeepThink |

Neither web UI exposes a numeric thinking budget, so the ladder is two rungs
rather than OpenAI's four. The bridge also accepts `reasoning_effort`,
`reasoning: { effort }` and a bare `thinking` boolean from any other client.

## Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Providers missing from the picker | plugin failed to load, or bridge down | check the DSH log, then `server.js`/`host.js` errors |
| `DeepSeek is not connected` | no account bound, or token expired | run `login` again |
| `PoW wasm not found` | `assets/` not copied | copy `assets/sha3_wasm_bg.wasm` |
| `HTTP 401/403` | session expired | re-run `login` |
| Gemini returns no text | `StreamGenerate` shape changed | update `src/providers/gemini.js` |
| Browser login times out | nobody signed in within 5 min | run `login` again and complete the sign-in |

## Uninstall

Remove the `insert` row from `cordis.patch.yml`, restart DSH, then delete
`node_modules/dsh-web-sub` and `~/.dsh/dsh-web-sub`.
