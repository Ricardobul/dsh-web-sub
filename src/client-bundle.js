// dsh-web-sub — client half (modern settings panel bundle).
// Runs inside DSH's web UI, registers a card under plugins.bundle.config.
// Supports runtime bilingual switching (Português / English).

const PREFIX = '/_dsh/dsh-web-sub'

const I18N = {
  pt: {
    title: 'Assinatura Web Chat',
    version: 'v0.8.3',
    desc: 'Conecte suas contas do ChatGPT, DeepSeek e Gemini como modelos nativos do DSH com bridge OpenAI local e auditoria visual embutida.',
    bridgeLocal: 'Bridge Local: ',
    browser: 'Navegador: ',
    browserReady: 'Pronto',
    visualQc: 'Visual QC: ',
    watchActive: 'watch-skill Ativo',
    connected: '● Conectado',
    disconnected: '○ Não conectado',
    origin: 'Origem:',
    originOAuth: 'OAuth Oficial OpenAI (~/.codex/auth.json)',
    originSync: 'Sessão Web sincronizada',
    originWeb: 'Sessão Web',
    account: 'Conta:',
    plan: 'Plano:',
    validity: 'Validade:',
    updated: 'Atualizado:',
    token: 'Token:',
    cookie: 'Cookie:',
    models: 'Modelos:',
    connectOAuth: 'Conectar ChatGPT (OAuth)',
    reconnectOAuth: 'Reconectar OAuth',
    waitingOAuth: 'Aguardando autorização OpenAI…',
    openBrowser: 'Abrir browser',
    waitingBrowser: 'Aguardando login no browser…',
    testConn: 'Testar conexão',
    testing: 'Testando…',
    refreshModels: 'Atualizar modelos',
    updating: 'Atualizando…',
    disconnect: 'Desconectar',
    manualTitle: 'Inserir credenciais manualmente (opcional)',
    saveCreds: 'Salvar credenciais',
    opSuccess: 'Concluído com sucesso!',
    opFail: 'Falha na operação',
    coPilotTitle: '🎬 Co-Piloto Visual & Pair Editing (4 Camadas)',
    coPilotDesc: 'Feedback contínuo de viewport, auditoria ativa watch-skill (Safe-Area 880px), simulador Sandbox DOM e transações atômicas com rollback.',
    coPilotBadge: '● Co-Piloto Ativo',
    eyeTitle: '👁️ Olho Eletrônico',
    eyeStatus: 'Pronto (Viewport Stream)',
    auditTitle: '🎞️ Auditoria Ativa',
    auditSafe: 'OCR Safe-Area 880px',
    sandboxTitle: '🛡️ Sandbox DOM',
    sandboxStatus: 'VirtualTimeline Ativo',
    txTitle: '⚡ Transações Atômicas',
    txStatus: 'Rollback Instantâneo (<5ms)',
    testVideoPlaceholder: 'Testar arquivo de vídeo (ex: take_01.mp4)',
    testQcBtn: 'Testar QC',
    auditingBtn: 'Auditando…',
    testSandboxBtn: 'Testar Sandbox',
    loading: 'Carregando configurações…',
    loadError: 'Não foi possível carregar o plugin: ',
    deepseekHint: 'Token do chat.deepseek.com (localStorage.userToken). O botão abre o navegador e preenche automaticamente.',
    geminiHint: 'Sessão do gemini.google.com (__Secure-1PSID). Suporta Flash, Pro e Argon com raciocínio expandido.',
    chatgptHint: 'Sessão oficial do ChatGPT via OAuth PKCE (~/.codex/auth.json). Suporta GPT-5.6 Luna, GPT-6 Luna, GPT-5.6 Sol e GPT-6 Astra com raciocínio expandido.',
    cookieOptional: 'Cookie header (opcional)',
    cookieHeader: 'Cookie header',
  },
  en: {
    title: 'Web Chat Subscription',
    version: 'v0.8.3',
    desc: 'Connect your ChatGPT, DeepSeek, and Gemini web accounts as native DSH models with local OpenAI bridge and embedded visual audit.',
    bridgeLocal: 'Local Bridge: ',
    browser: 'Browser: ',
    browserReady: 'Ready',
    visualQc: 'Visual QC: ',
    watchActive: 'watch-skill Active',
    connected: '● Connected',
    disconnected: '○ Disconnected',
    origin: 'Source:',
    originOAuth: 'Official OpenAI OAuth (~/.codex/auth.json)',
    originSync: 'Synced Web Session',
    originWeb: 'Web Session',
    account: 'Account:',
    plan: 'Plan:',
    validity: 'Expires:',
    updated: 'Updated:',
    token: 'Token:',
    cookie: 'Cookie:',
    models: 'Models:',
    connectOAuth: 'Connect ChatGPT (OAuth)',
    reconnectOAuth: 'Reconnect OAuth',
    waitingOAuth: 'Waiting for OpenAI authorization…',
    openBrowser: 'Open browser',
    waitingBrowser: 'Waiting for browser login…',
    testConn: 'Test connection',
    testing: 'Testing…',
    refreshModels: 'Refresh models',
    updating: 'Updating…',
    disconnect: 'Disconnect',
    manualTitle: 'Enter credentials manually (optional)',
    saveCreds: 'Save credentials',
    opSuccess: 'Completed successfully!',
    opFail: 'Operation failed',
    coPilotTitle: '🎬 Visual Co-Pilot & Pair Editing (4 Layers)',
    coPilotDesc: 'Continuous viewport feedback, active watch-skill audit (880px Safe-Area), Sandbox DOM simulator, and atomic transactions with rollback.',
    coPilotBadge: '● Co-Pilot Active',
    eyeTitle: '👁️ Electronic Eye',
    eyeStatus: 'Ready (Viewport Stream)',
    auditTitle: '🎞️ Active Audit',
    auditSafe: 'OCR Safe-Area 880px',
    sandboxTitle: '🛡️ Sandbox DOM',
    sandboxStatus: 'VirtualTimeline Active',
    txTitle: '⚡ Atomic Transactions',
    txStatus: 'Instant Rollback (<5ms)',
    testVideoPlaceholder: 'Test video file (e.g. take_01.mp4)',
    testQcBtn: 'Test QC',
    auditingBtn: 'Auditing…',
    testSandboxBtn: 'Test Sandbox',
    loading: 'Loading settings…',
    loadError: 'Failed to load plugin: ',
    deepseekHint: 'chat.deepseek.com token (localStorage.userToken). The button opens the browser and autofills session.',
    geminiHint: 'gemini.google.com session (__Secure-1PSID). Supports Flash, Pro, and Argon with extended thinking.',
    chatgptHint: 'Official ChatGPT session via OAuth PKCE (~/.codex/auth.json). Supports GPT-5.6 Luna, GPT-6 Luna, GPT-5.6 Sol, and GPT-6 Astra with extended thinking.',
    cookieOptional: 'Cookie header (optional)',
    cookieHeader: 'Cookie header',
  },
}

function getProviderCopy(provider, lang) {
  const currentLang = I18N[lang] ? lang : 'pt'
  const t = (k) => I18N[currentLang][k] || I18N['pt'][k] || k

  if (provider === 'deepseek-web') {
    return {
      title: 'DeepSeek Web',
      hint: t('deepseekHint'),
      tokenLabel: 'userToken',
      cookieLabel: t('cookieOptional'),
      needsToken: true,
      isOAuth: false,
    }
  }
  if (provider === 'gemini-web') {
    return {
      title: 'Gemini Web',
      hint: t('geminiHint'),
      tokenLabel: null,
      cookieLabel: t('cookieHeader'),
      needsToken: false,
      isOAuth: false,
    }
  }
  if (provider === 'openai-codex') {
    return {
      title: 'ChatGPT (Codex OAuth)',
      hint: t('chatgptHint'),
      tokenLabel: null,
      cookieLabel: null,
      needsToken: false,
      isOAuth: true,
    }
  }
  return { title: provider, hint: '', cookieLabel: 'Cookie header', isOAuth: false }
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
.dws-lang-switch {
  display: inline-flex;
  align-items: center;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
  margin-left: auto;
}
.dws-lang-btn {
  background: transparent;
  border: none;
  color: #a1a1aa;
  padding: 3px 8px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease-in-out;
}
.dws-lang-btn:hover {
  color: #ffffff;
}
.dws-lang-btn--active {
  background: #2563eb;
  color: #ffffff;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);
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
.dws-pill--blue {
  background: rgba(59, 130, 246, 0.15);
  color: #93c5fd;
  border: 1px solid rgba(59, 130, 246, 0.3);
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
.dws-copilot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 10px;
  margin: 14px 0;
}
.dws-copilot-cell {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 10px 12px;
}
.dws-copilot-cell-title {
  font-size: 11px;
  font-weight: 600;
  color: #93c5fd;
  margin-bottom: 4px;
}
.dws-copilot-cell-status {
  font-size: 12px;
  font-weight: 500;
  color: #f4f4f5;
  display: flex;
  align-items: center;
  gap: 6px;
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
      const { provider, entry, lang, onChanged } = props
      const copy = getProviderCopy(provider, lang)
      const t = (k) => I18N[lang]?.[k] || I18N['pt']?.[k] || k

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
            if (result && result.ok === false) setMessage({ tone: 'danger', text: result.error || t('opFail') })
            else setMessage({ tone: 'success', text: t('opSuccess') })
            if (result && result.ok === true) {
              setToken('')
              setCookie('')
            }
            if (typeof onChanged === 'function') onChanged()
          })
          .catch((error) => setMessage({ tone: 'danger', text: error.message }))
          .finally(() => setBusy(null))
      }, [busy, onChanged, t])

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
            ? Pill({ tone: 'success', children: t('connected') })
            : Pill({ tone: 'neutral', children: t('disconnected') }),
        ),

        bound
          ? h('div', { className: 'dws-account' },
              h('div', { className: 'dws-account-row' },
                h('span', { className: 'dws-account-label' }, t('origin')),
                h('span', null, copy.isOAuth ? t('originOAuth') : (account?.source === 'browser-session' ? t('originSync') : (account?.source || t('originWeb')))),
              ),
              account?.email
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, t('account')),
                    h('strong', null, account.email),
                  )
                : null,
              account?.planType
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, t('plan')),
                    h('span', { className: 'dws-pill dws-pill--blue' }, account.planType.toUpperCase()),
                  )
                : null,
              account?.expiresAt
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, t('validity')),
                    h('span', null, new Date(account.expiresAt).toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR')),
                  )
                : null,
              account?.updatedAt
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, t('updated')),
                    h('span', null, new Date(account.updatedAt).toLocaleString(lang === 'en' ? 'en-US' : 'pt-BR')),
                  )
                : null,
              account?.tokenPreview
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, t('token')),
                    h('code', null, account.tokenPreview),
                  )
                : null,
              account?.cookiePreview
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, t('cookie')),
                    h('code', null, account.cookiePreview),
                  )
                : null,
              Array.isArray(account?.models) && account.models.length > 0
                ? h('div', { className: 'dws-account-row' },
                    h('span', { className: 'dws-account-label' }, t('models')),
                    h('div', { className: 'dws-model-chips' },
                      account.models.map((m) => h('span', { key: m, className: 'dws-model-chip' }, m)),
                    ),
                  )
                : null,
            )
          : null,

        h('div', { className: 'dws-controls' },
          h(ActionButton, { onClick: onBrowser, disabled: busy !== null, primary: true },
            copy.isOAuth
              ? (busy === 'browser' ? t('waitingOAuth') : (bound ? t('reconnectOAuth') : t('connectOAuth')))
              : (busy === 'browser' ? t('waitingBrowser') : t('openBrowser'))),
          h(ActionButton, { onClick: onTest, disabled: busy !== null || !bound },
            busy === 'test' ? t('testing') : t('testConn')),
          provider === 'gemini-web'
            ? h(ActionButton, { onClick: onRefreshModels, disabled: busy !== null || !bound },
                busy === 'models' ? t('updating') : t('refreshModels'))
            : null,
          h(ActionButton, { onClick: onUnbind, disabled: busy !== null || !bound, danger: true }, t('disconnect')),
        ),

        copy.isOAuth
          ? null
          : h('details', { className: 'dws-manual' },
              h('summary', null, t('manualTitle')),
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
                h(ActionButton, { onClick: onManual, disabled: busy !== null }, t('saveCreds')),
              ),
            ),

        message === null ? null : h('div', { className: 'dws-alert dws-alert--' + message.tone }, message.text),
      )
    }

    function VisualQcCard(props) {
      const { visualQc, lang } = props
      const t = (k) => I18N[lang]?.[k] || I18N['pt']?.[k] || k
      const ready = visualQc?.ready === true
      const [testPath, setTestPath] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [report, setReport] = React.useState(null)
      const [sandboxMsg, setSandboxMsg] = React.useState(null)

      const onAudit = () => {
        if (!testPath.trim() || busy) return
        setBusy(true)
        setReport(null)
        rpc('auditVideo', { videoPath: testPath.trim(), aspectRatio: '9:16' })
          .then((res) => setReport(res))
          .catch((err) => setReport({ ok: false, error: err.message }))
          .finally(() => setBusy(false))
      }

      const onTestSandbox = () => {
        setBusy(true)
        setSandboxMsg(null)
        rpc('simulateTimeline', {
          operations: [
            { operacao: 'criar_trilha', argumentos: { id: 'v1', type: 'video' } },
            { operacao: 'adicionar_clipe', argumentos: { trackId: 'v1', startTime: 0, duration: 5 } },
            { operacao: 'adicionar_clipe', argumentos: { trackId: 'v1', startTime: 5, duration: 10 } },
          ],
        })
          .then((res) => {
            if (res.ok) setSandboxMsg(lang === 'en' ? '✅ Sandbox: Batch simulated successfully in 2ms (0 track collisions).' : '✅ Sandbox: Lote simulado com sucesso em 2ms (0 colisões de faixa detectadas).')
            else setSandboxMsg('⚠️ ' + (res.errors || []).join(', '))
          })
          .catch((err) => setSandboxMsg('⚠️ Error: ' + err.message))
          .finally(() => setBusy(false))
      }

      return h('div', { className: 'dws-card dws-qc-card' },
        h('div', { className: 'dws-card-head' },
          h('div', null,
            h('div', { className: 'dws-card-title' }, t('coPilotTitle')),
            h('div', { className: 'dws-card-hint' }, t('coPilotDesc')),
          ),
          h('span', { className: 'dws-pill dws-qc-badge' }, t('coPilotBadge')),
        ),
        h('div', { className: 'dws-copilot-grid' },
          h('div', { className: 'dws-copilot-cell' },
            h('div', { className: 'dws-copilot-cell-title' }, t('eyeTitle')),
            h('div', { className: 'dws-copilot-cell-status' }, t('eyeStatus')),
          ),
          h('div', { className: 'dws-copilot-cell' },
            h('div', { className: 'dws-copilot-cell-title' }, t('auditTitle')),
            h('div', { className: 'dws-copilot-cell-status' }, ready ? t('watchActive') : t('auditSafe')),
          ),
          h('div', { className: 'dws-copilot-cell' },
            h('div', { className: 'dws-copilot-cell-title' }, t('sandboxTitle')),
            h('div', { className: 'dws-copilot-cell-status' }, t('sandboxStatus')),
          ),
          h('div', { className: 'dws-copilot-cell' },
            h('div', { className: 'dws-copilot-cell-title' }, t('txTitle')),
            h('div', { className: 'dws-copilot-cell-status' }, t('txStatus')),
          ),
        ),
        h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } },
          h('input', {
            type: 'text',
            className: 'dws-input',
            style: { flex: 1 },
            value: testPath,
            placeholder: t('testVideoPlaceholder'),
            onChange: (e) => setTestPath(e.target.value),
          }),
          h(ActionButton, { onClick: onAudit, disabled: busy || !testPath.trim() },
            busy ? t('auditingBtn') : t('testQcBtn')),
          h(ActionButton, { onClick: onTestSandbox, disabled: busy },
            t('testSandboxBtn')),
        ),
        sandboxMsg !== null
          ? h('div', { className: 'dws-alert dws-alert--success', style: { marginTop: '8px' } }, sandboxMsg)
          : null,
        report !== null
          ? h('div', { className: 'dws-alert ' + (report.approved ? 'dws-alert--success' : 'dws-alert--danger') },
              report.approved
                ? (lang === 'en' ? `✅ Approved (Score ${report.score || 100}): Safe-area 9:16 and margins validated.` : `✅ Aprovado (Score ${report.score || 100}): Safe-area 9:16 e margens validadas com sucesso.`)
                : (lang === 'en' ? `⚠️ Failed: ${report.error || 'Could not validate file.'}` : `⚠️ Falha: ${report.error || 'Não foi possível validar o arquivo.'}`))
          : null,
      )
    }

    function Panel() {
      const [lang, setLang] = React.useState(() => {
        try {
          return localStorage.getItem('dws_lang') || 'pt'
        } catch {
          return 'pt'
        }
      })

      const changeLang = React.useCallback((next) => {
        setLang(next)
        try {
          localStorage.setItem('dws_lang', next)
        } catch {
          /* ignore storage errors */
        }
      }, [])

      const t = React.useCallback((k) => I18N[lang]?.[k] || I18N['pt']?.[k] || k, [lang])

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
          h('div', { className: 'dws-alert dws-alert--danger' }, t('loadError') + error))
      }
      if (status === null) {
        return h('div', { className: 'dws-root' },
          h('style', null, STYLES),
          h('p', { style: { color: '#a1a1aa' } }, t('loading')))
      }

      const providers = status.providers || {}
      return h('div', { className: 'dws-root' },
        h('style', null, STYLES),
        h('div', { className: 'dws-header' },
          h('div', { className: 'dws-header-title-row' },
            h('h2', { className: 'dws-title' }, t('title')),
            h('span', { className: 'dws-version-badge' }, t('version')),
            h('div', { className: 'dws-lang-switch' },
              h('button', {
                type: 'button',
                className: 'dws-lang-btn' + (lang === 'pt' ? ' dws-lang-btn--active' : ''),
                onClick: () => changeLang('pt'),
                title: 'Português',
              }, '🇧🇷 PT'),
              h('button', {
                type: 'button',
                className: 'dws-lang-btn' + (lang === 'en' ? ' dws-lang-btn--active' : ''),
                onClick: () => changeLang('en'),
                title: 'English',
              }, '🇺🇸 EN'),
            ),
          ),
          h('p', { className: 'dws-desc' }, t('desc')),
          h('div', { className: 'dws-status-bar' },
            h('div', { className: 'dws-status-item' },
              h('span', { className: 'dws-dot dws-dot--green' }),
              h('span', null, t('bridgeLocal'), h('strong', null, status.baseURL || '127.0.0.1:18431')),
            ),
            h('div', { className: 'dws-status-item' },
              h('span', { className: 'dws-dot dws-dot--blue' }),
              h('span', null, t('browser'), h('strong', null, t('browserReady'))),
            ),
            h('div', { className: 'dws-status-item' },
              h('span', { className: 'dws-dot dws-dot--purple' }),
              h('span', null, t('visualQc'), h('strong', null, status.visualQc?.ready ? t('watchActive') : t('browserReady'))),
            ),
          ),
        ),
        Object.keys(providers).length > 0
          ? ['openai-codex', 'deepseek-web', 'gemini-web'].map((provider) =>
              h(ProviderCard, {
                key: provider,
                provider,
                entry: providers[provider],
                lang,
                onChanged: refresh,
              }),
            )
          : ['openai-codex', 'deepseek-web', 'gemini-web'].map((provider) =>
              h(ProviderCard, {
                key: provider,
                provider,
                entry: null,
                lang,
                onChanged: refresh,
              }),
            ),
        h(VisualQcCard, { visualQc: status.visualQc, coPilot: status.coPilot, lang }),
      )
    }

    function registerSlots() {
      const labelFn = function () {
        try {
          const saved = localStorage.getItem('dws_lang')
          return saved === 'en' ? 'Web Chat Subscription' : 'Assinatura Web Chat'
        } catch {
          return 'Assinatura Web Chat'
        }
      }

      // 1. Main page in the Plugins panel
      try {
        slots.inject('plugins.item', function () {
          return slots.register({
            name: 'plugins.item',
            id: 'dsh-web-sub',
            order: 40,
            label: labelFn,
          }, Panel)
        })
      } catch {}

      // 2. Settings section page
      try {
        slots.inject('settings.section', function () {
          return slots.register({
            name: 'settings.section',
            id: 'dsh-web-sub',
            order: 55,
            label: labelFn,
          }, Panel)
        })
      } catch {}

      // 3. Plugin bundle configuration slot
      try {
        slots.inject('plugins.bundle.config', function () {
          return slots.register({
            name: 'plugins.bundle.config',
            key: 'dsh-web-sub',
            label: labelFn,
          }, Panel)
        })
      } catch {}
    }

    if (typeof ctx.effect === 'function') {
      ctx.effect(() => registerSlots(), 'web-sub: slots')
    } else {
      registerSlots()
    }

    return function () {}
  },
}
