// dsh-web-sub — client half (modern settings panel bundle).
// Runs inside DSH's web UI, registers a card under plugins.bundle.config.

const PREFIX = '/_dsh/dsh-web-sub'

const PROVIDER_COPY = {
  'deepseek-web': {
    title: 'DeepSeek Web',
    hint: 'Token do chat.deepseek.com (localStorage.userToken). O botão abre o navegador e preenche automaticamente.',
    tokenLabel: 'userToken',
    cookieLabel: 'Cookie header (opcional)',
    needsToken: true,
  },
  'gemini-web': {
    title: 'Gemini Web',
    hint: 'Sessão do gemini.google.com (__Secure-1PSID). Suporta Flash, Pro e Argon com raciocínio expandido.',
    tokenLabel: null,
    cookieLabel: 'Cookie header',
    needsToken: false,
  },
}

const STYLES = `
.dws-root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  color: #e4e4e7;
  padding: 16px 20px;
  max-width: 900px;
  margin: 0 auto;
}
.dws-header {
  margin-bottom: 22px;
}
.dws-header-title-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 6px;
}
.dws-title {
  font-size: 22px;
  font-weight: 700;
  color: #ffffff;
  letter-spacing: -0.02em;
  margin: 0;
}
.dws-version-badge {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 9999px;
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.2), rgba(147, 51, 234, 0.2));
  color: #93c5fd;
  border: 1px solid rgba(147, 197, 253, 0.3);
}
.dws-desc {
  font-size: 13px;
  color: #a1a1aa;
  margin: 0;
  line-height: 1.5;
}
.dws-status-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 14px;
  padding: 10px 14px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.06);
}
.dws-status-item {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: #d4d4d8;
}
.dws-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}
.dws-dot--green {
  background: #10b981;
  box-shadow: 0 0 8px rgba(16, 185, 129, 0.6);
}
.dws-dot--blue {
  background: #3b82f6;
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.5);
}
.dws-dot--purple {
  background: #a855f7;
  box-shadow: 0 0 8px rgba(168, 85, 247, 0.5);
}
.dws-card {
  background: rgba(24, 24, 27, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 18px 20px;
  margin-bottom: 20px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  transition: border-color 0.2s, box-shadow 0.2s;
}
.dws-card:hover {
  border-color: rgba(255, 255, 255, 0.14);
}
.dws-card-head {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 14px;
}
.dws-card-title {
  font-size: 16px;
  font-weight: 600;
  color: #ffffff;
  margin-bottom: 4px;
}
.dws-card-hint {
  font-size: 12px;
  color: #a1a1aa;
  line-height: 1.4;
}
.dws-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  padding: 4px 10px;
  border-radius: 9999px;
  white-space: nowrap;
}
.dws-pill--success {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.3);
}
.dws-pill--neutral {
  background: rgba(255, 255, 255, 0.06);
  color: #a1a1aa;
  border: 1px solid rgba(255, 255, 255, 0.1);
}
.dws-account {
  background: rgba(0, 0, 0, 0.25);
  border: 1px solid rgba(255, 255, 255, 0.05);
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 16px;
  font-size: 12px;
  color: #d4d4d8;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.dws-account-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.dws-account-label {
  color: #71717a;
  min-width: 90px;
  font-weight: 500;
}
.dws-account code {
  background: rgba(255, 255, 255, 0.08);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 11px;
  color: #e4e4e7;
}
.dws-model-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.dws-model-chip {
  background: rgba(59, 130, 246, 0.12);
  border: 1px solid rgba(59, 130, 246, 0.25);
  color: #93c5fd;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
}
.dws-controls {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 14px;
}
.dws-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 7px 14px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.06);
  color: #f4f4f5;
}
.dws-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.12);
  border-color: rgba(255, 255, 255, 0.2);
  color: #ffffff;
}
.dws-btn--primary {
  background: #2563eb;
  border-color: #3b82f6;
  color: #ffffff;
  font-weight: 600;
}
.dws-btn--primary:hover:not(:disabled) {
  background: #1d4ed8;
  border-color: #60a5fa;
}
.dws-btn--danger {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.25);
  color: #f87171;
}
.dws-btn--danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.2);
  border-color: rgba(239, 68, 68, 0.4);
  color: #ef4444;
}
.dws-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.dws-manual {
  margin-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  padding-top: 12px;
}
.dws-manual summary {
  font-size: 12px;
  color: #a1a1aa;
  cursor: pointer;
  user-select: none;
  font-weight: 500;
  outline: none;
}
.dws-manual summary:hover {
  color: #d4d4d8;
}
.dws-manual-form {
  margin-top: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.dws-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.dws-field span {
  font-size: 11px;
  color: #a1a1aa;
  font-weight: 500;
}
.dws-input, .dws-textarea {
  background: rgba(0, 0, 0, 0.3);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  padding: 8px 10px;
  font-size: 12px;
  color: #ffffff;
  font-family: inherit;
  outline: none;
  transition: border-color 0.15s;
}
.dws-input:focus, .dws-textarea:focus {
  border-color: #3b82f6;
}
.dws-alert {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
  margin-top: 12px;
}
.dws-alert--success {
  background: rgba(16, 185, 129, 0.15);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.25);
}
.dws-alert--danger {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.25);
}
.dws-qc-card {
  background: linear-gradient(135deg, rgba(30, 27, 75, 0.35), rgba(24, 24, 27, 0.7));
  border: 1px solid rgba(129, 140, 248, 0.25);
}
.dws-qc-badge {
  background: rgba(129, 140, 248, 0.15);
  border: 1px solid rgba(129, 140, 248, 0.3);
  color: #c7d2fe;
}
`

function rpc(method, args) {
  const mutating = method !== 'getStatus' && method !== 'checkVisualQc'
  return fetch(PREFIX + '/' + method, {
    method: mutating ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json' },
    body: mutating ? JSON.stringify(args || {}) : undefined,
  })
    .then((response) => response.json())
    .catch((error) => ({ ok: false, error: error.message }))
}

module.exports = {
  inject: ['slots'],
  async apply(ctx) {
    let slots = ctx.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : undefined)
    for (let attempt = 0; slots === undefined && attempt < 60; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 300))
      slots = ctx.slots || (typeof ctx.get === 'function' ? ctx.get('slots') : undefined)
    }
    if (slots === undefined) {
      console.warn('[dsh-web-sub] slots service not ready — settings card not registered')
      return
    }

    const React = require('react')
    const primitives = (() => {
      try {
        return require('@deepseek-ai/dsh-client-ui-primitives')
      } catch {
        return null
      }
    })()
    const Button = primitives?.Button ?? null
    const Tag = primitives?.Tag ?? null

    const h = React.createElement

    function ActionButton(props) {
      if (Button !== null) {
        return h(Button, {
          type: 'button',
          variant: props.primary ? 'solid' : (props.variant || 'outline'),
          size: 'sm',
          disabled: props.disabled,
          onClick: props.onClick,
        }, props.children)
      }
      return h('button', {
        type: 'button',
        className: 'dws-btn' + (props.primary ? ' dws-btn--primary' : '') + (props.danger ? ' dws-btn--danger' : ''),
        disabled: props.disabled,
        onClick: props.onClick,
      }, props.children)
    }

    function Pill(props) {
      if (Tag !== null) return h(Tag, { tone: props.tone }, props.children)
      return h('span', { className: 'dws-pill dws-pill--' + props.tone }, props.children)
    }

    function ProviderCard(props) {
      const { provider, entry, onChanged } = props
      const copy = PROVIDER_COPY[provider] || { title: provider, hint: '', cookieLabel: 'Cookie header' }
      const [token, setToken] = React.useState('')
      const [cookie, setCookie] = React.useState('')
      const [busy, setBusy] = React.useState(null)
      const [message, setMessage] = React.useState(null)

      const run = React.useCallback((label, fn) => {
        if (busy !== null) return
        setBusy(label)
        setMessage(null)
        fn()
          .then((result) => {
            if (result && result.ok === false) setMessage({ tone: 'danger', text: result.error || 'Falha na operação' })
            else setMessage({ tone: 'success', text: 'Concluído com sucesso!' })
            if (result && result.ok === true) {
              setToken('')
              setCookie('')
            }
            if (typeof onChanged === 'function') onChanged()
          })
          .catch((error) => setMessage({ tone: 'danger', text: error.message }))
          .finally(() => setBusy(null))
      }, [busy, onChanged])

      const onBrowser = () => run('browser', () => rpc('autoLogin', { provider }))
      const onManual = () => run('manual', () => rpc('bindManual', { provider, token, cookie }))
      const onTest = () => run('test', () => rpc('test', { provider }))
      const onUnbind = () => run('unbind', () => rpc('unbind', { provider }))
      const onRefreshModels = () => run('models', () => rpc('refreshModels', { provider }))

      const bound = entry?.bound === true
      const account = entry?.account

      return h('div', { className: 'dws-card' },
        h('div', { className: 'dws-card-head' },
          h('div', null,
            h('div', { className: 'dws-card-title' }, copy.title),
            h('div', { className: 'dws-card-hint' }, copy.hint),
          ),
          bound
            ? Pill({ tone: 'success', children: '● Conectado' })
            : Pill({ tone: 'neutral', children: '○ Não conectado' }),
        ),

        bound
          ? h('div', { className: 'dws-account' },
              h('div', { className: 'dws-account-row' },
                h('span', { className: 'dws-account-label' }, 'Origem:'),
                h('span', null, account?.source === 'browser-session' ? 'Sessão Web sincronizada' : (account?.source || 'Sessão Web')),
              ),
              account?.updatedAt
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, 'Atualizado:'),
                    h('span', null, new Date(account.updatedAt).toLocaleString()),
                  )
                : null,
              account?.tokenPreview
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, 'Token:'),
                    h('code', null, account.tokenPreview),
                  )
                : null,
              account?.cookiePreview
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, 'Cookie:'),
                    h('code', null, account.cookiePreview),
                  )
                : null,
              Array.isArray(account?.models) && account.models.length > 0
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, 'Modelos:'),
                    h('div', { className: 'dws-model-chips' },
                      account.models.map((m) => h('span', { key: m, className: 'dws-model-chip' }, m)),
                    ),
                  )
                : null,
            )
          : null,

        h('div', { className: 'dws-controls' },
          h(ActionButton, { onClick: onBrowser, disabled: busy !== null, primary: true },
            busy === 'browser' ? 'Aguardando login no browser…' : 'Abrir browser'),
          h(ActionButton, { onClick: onTest, disabled: busy !== null || !bound },
            busy === 'test' ? 'Testando…' : 'Testar conexão'),
          provider === 'gemini-web'
            ? h(ActionButton, { onClick: onRefreshModels, disabled: busy !== null || !bound },
                busy === 'models' ? 'Atualizando…' : 'Atualizar modelos')
            : null,
          h(ActionButton, { onClick: onUnbind, disabled: busy !== null || !bound, danger: true }, 'Desconectar'),
        ),

        h('details', { className: 'dws-manual' },
          h('summary', null, 'Inserir credenciais manualmente (opcional)'),
          h('div', { className: 'dws-manual-form' },
            copy.tokenLabel !== null
              ? h('label', { className: 'dws-field' },
                  h('span', null, copy.tokenLabel),
                  h('input', {
                    type: 'password',
                    className: 'dws-input',
                    value: token,
                    placeholder: 'eyJhbGciOi…',
                    onChange: (event) => setToken(event.target.value),
                  }),
                )
              : null,
            h('label', { className: 'dws-field' },
              h('span', null, copy.cookieLabel),
              h('textarea', {
                rows: 3,
                className: 'dws-textarea',
                value: cookie,
                placeholder: '__Secure-1PSID=…; __Secure-1PSIDTS=…',
                onChange: (event) => setCookie(event.target.value),
              }),
            ),
            h(ActionButton, { onClick: onManual, disabled: busy !== null }, 'Salvar credenciais'),
          ),
        ),

        message === null ? null : h('div', { className: 'dws-alert dws-alert--' + message.tone }, message.text),
      )
    }

    function VisualQcCard(props) {
      const { visualQc } = props
      const ready = visualQc?.ready === true
      const [testPath, setTestPath] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [report, setReport] = React.useState(null)

      const onAudit = () => {
        if (!testPath.trim() || busy) return
        setBusy(true)
        setReport(null)
        rpc('auditVideo', { videoPath: testPath.trim(), aspectRatio: '9:16' })
          .then((res) => setReport(res))
          .catch((err) => setReport({ ok: false, error: err.message }))
          .finally(() => setBusy(false))
      }

      return h('div', { className: 'dws-card dws-qc-card' },
        h('div', { className: 'dws-card-head' },
          h('div', null,
            h('div', { className: 'dws-card-title' }, '🎬 Auditoria Visual & Motion QC (watch-skill)'),
            h('div', { className: 'dws-card-hint' },
              'Integração nativa com watch-skill para auditoria de Safe-Area (9:16 / 16:9), corte de texto e integridade de motion graphics.'),
          ),
          ready
            ? h('span', { className: 'dws-pill dws-qc-badge' }, '● Engine Pronto')
            : h('span', { className: 'dws-pill dws-pill--neutral' }, '○ Opcional'),
        ),
        h('div', { className: 'dws-account' },
          h('div', { className: 'dws-account-row' },
            h('span', { className: 'dws-account-label' }, 'Motor QC:'),
            h('span', null, visualQc?.engine || 'watch-skill v1.4.3'),
          ),
          h('div', { className: 'dws-account-row' },
            h('span', { className: 'dws-account-label' }, 'Uso no Chat:'),
            h('span', null, 'Os modelos (Argon e DeepSeek) executam auditorias automáticas via ferramenta "auditar_video" ou CLI.'),
          ),
        ),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
          h('input', {
            type: 'text',
            className: 'dws-input',
            style: { flex: 1 },
            value: testPath,
            placeholder: 'Testar arquivo de vídeo (ex: take_01.mp4)',
            onChange: (e) => setTestPath(e.target.value),
          }),
          h(ActionButton, { onClick: onAudit, disabled: busy || !testPath.trim() },
            busy ? 'Auditando…' : 'Testar QC'),
        ),
        report !== null
          ? h('div', { className: 'dws-alert ' + (report.approved ? 'dws-alert--success' : 'dws-alert--danger') },
              report.approved
                ? `✅ Aprovado (Score ${report.score || 100}): Safe-area 9:16 e margens validadas com sucesso.`
                : `⚠️ Falha: ${report.error || 'Não foi possível validar o arquivo.'}`)
          : null,
      )
    }

    function Panel() {
      const [status, setStatus] = React.useState(null)
      const [error, setError] = React.useState(null)

      const refresh = React.useCallback(() => {
        rpc('getStatus')
          .then((result) => {
            if (result && result.ok === false) setError(result.error || 'status indisponível')
            else {
              setError(null)
              setStatus(result)
            }
          })
          .catch((failure) => setError(failure.message))
      }, [])

      React.useEffect(() => { refresh() }, [refresh])

      if (error !== null) {
        return h('div', { className: 'dws-root' },
          h('style', null, STYLES),
          h('div', { className: 'dws-alert dws-alert--danger' }, 'Não foi possível carregar o plugin: ' + error))
      }
      if (status === null) {
        return h('div', { className: 'dws-root' },
          h('style', null, STYLES),
          h('p', { style: { color: '#a1a1aa' } }, 'Carregando configurações…'))
      }

      const providers = status.providers || {}
      return h('div', { className: 'dws-root' },
        h('style', null, STYLES),
        h('div', { className: 'dws-header' },
          h('div', { className: 'dws-header-title-row' },
            h('h2', { className: 'dws-title' }, 'Web Chat Subscription'),
            h('span', { className: 'dws-version-badge' }, 'v0.6.1'),
          ),
          h('p', { className: 'dws-desc' },
            'Conecte suas contas web do DeepSeek e Gemini como modelos nativos do DSH com bridge OpenAI local e auditoria visual embutida.'),
          h('div', { className: 'dws-status-bar' },
            h('div', { className: 'dws-status-item' },
              h('span', { className: 'dws-dot dws-dot--green' }),
              h('span', null, 'Bridge Local: ', h('strong', null, status.baseURL || '127.0.0.1:18431')),
            ),
            h('div', { className: 'dws-status-item' },
              h('span', { className: 'dws-dot dws-dot--blue' }),
              h('span', null, 'Navegador: ', h('strong', null, 'Pronto')),
            ),
            h('div', { className: 'dws-status-item' },
              h('span', { className: 'dws-dot dws-dot--purple' }),
              h('span', null, 'Visual QC: ', h('strong', null, status.visualQc?.ready ? 'watch-skill Ativo' : 'Pronto')),
            ),
          ),
        ),
        Object.keys(PROVIDER_COPY).map((provider) =>
          h(ProviderCard, {
            key: provider,
            provider,
            entry: providers[provider],
            onChanged: refresh,
          }),
        ),
        h(VisualQcCard, { visualQc: status.visualQc }),
      )
    }

    const dispose = slots.inject('plugins.bundle.config', function () {
      return slots.register({
        name: 'plugins.bundle.config',
        key: 'dsh-web-sub',
        label: function () { return 'Web Chat Subscription' },
      }, Panel)
    })

    return function () {
      if (dispose) dispose()
    }
  },
}
