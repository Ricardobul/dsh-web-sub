// dsh-web-sub — client half (settings panel bundle).
// Runs inside DSH's web UI, registers a card under plugins.bundle.config.

const PREFIX = '/_dsh/dsh-web-sub'

const PROVIDER_COPY = {
  'deepseek-web': {
    title: 'DeepSeek Web',
    hint: 'Token from chat.deepseek.com (localStorage.userToken). The browser button fills it in for you.',
    tokenLabel: 'userToken',
    cookieLabel: 'Cookie header (optional)',
    needsToken: true,
  },
  'gemini-web': {
    title: 'Gemini Web',
    hint: 'Cookie header from gemini.google.com — __Secure-1PSID is the one that matters.',
    tokenLabel: null,
    cookieLabel: 'Cookie header',
    needsToken: false,
  },
}

function rpc(method, args) {
  const mutating = method !== 'getStatus'
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
          variant: props.variant || 'outline',
          size: 'sm',
          disabled: props.disabled,
          onClick: props.onClick,
        }, props.children)
      }
      return h('button', {
        type: 'button',
        className: 'dws-btn' + (props.danger ? ' dws-btn--danger' : ''),
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
            if (result && result.ok === false) setMessage({ tone: 'danger', text: result.error || 'failed' })
            else setMessage({ tone: 'success', text: 'done' })
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
        h('div', { className: 'dws-cardHead' },
          h('div', null,
            h('div', { className: 'dws-cardTitle' }, copy.title),
            h('div', { className: 'dws-cardHint' }, copy.hint),
          ),
          bound
            ? Pill({ tone: 'success', children: 'Connected' })
            : Pill({ tone: 'neutral', children: 'Not connected' }),
        ),

        bound
          ? h('div', { className: 'dws-account' },
              h('div', null, 'source: ', h('strong', null, account?.source || 'unknown')),
              account?.updatedAt ? h('div', null, 'updated: ', account.updatedAt) : null,
              account?.tokenPreview ? h('div', null, 'token: ', h('code', null, account.tokenPreview)) : null,
              account?.cookiePreview ? h('div', null, 'cookie: ', h('code', null, account.cookiePreview)) : null,
              Array.isArray(account?.models) && account.models.length > 0
                ? h('div', null, 'models: ', h('code', null, account.models.join(' · ')))
                : null,
            )
          : null,

        h('div', { className: 'dws-controls' },
          h(ActionButton, { onClick: onBrowser, disabled: busy !== null },
            busy === 'browser' ? 'Waiting for sign-in…' : 'Connect with browser'),
          h(ActionButton, { onClick: onTest, disabled: busy !== null || !bound }, 'Test'),
          provider === 'gemini-web'
            ? h(ActionButton, { onClick: onRefreshModels, disabled: busy !== null || !bound },
                busy === 'models' ? 'Refreshing…' : 'Refresh models')
            : null,
          h(ActionButton, { onClick: onUnbind, disabled: busy !== null || !bound, danger: true }, 'Disconnect'),
        ),

        h('details', { className: 'dws-manual' },
          h('summary', null, 'Paste credentials manually'),
          copy.tokenLabel !== null
            ? h('label', { className: 'dws-field' },
                h('span', null, copy.tokenLabel),
                h('input', {
                  type: 'password',
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
              value: cookie,
              placeholder: '__Secure-1PSID=…; __Secure-1PSIDTS=…',
              onChange: (event) => setCookie(event.target.value),
            }),
          ),
          h(ActionButton, { onClick: onManual, disabled: busy !== null }, 'Save'),
        ),

        message === null ? null : h('div', { className: 'dws-msg dws-msg--' + message.tone }, message.text),
      )
    }

    function Panel() {
      const [status, setStatus] = React.useState(null)
      const [error, setError] = React.useState(null)

      const refresh = React.useCallback(() => {
        rpc('getStatus')
          .then((result) => {
            if (result && result.ok === false) setError(result.error || 'status unavailable')
            else {
              setError(null)
              setStatus(result)
            }
          })
          .catch((failure) => setError(failure.message))
      }, [])

      React.useEffect(() => { refresh() }, [refresh])

      if (error !== null) {
        return h('div', { className: 'dws-panel' },
          h('div', { className: 'dws-msg dws-msg--danger' }, 'Could not read plugin status: ' + error))
      }
      if (status === null) {
        return h('div', { className: 'dws-panel' }, h('p', null, 'Loading…'))
      }

      const providers = status.providers || {}
      return h('div', { className: 'dws-panel' },
        h('div', { className: 'dws-head' },
          h('h2', { className: 'dws-title' }, 'Web Chat Subscription'),
          h('p', { className: 'dws-desc' }, 'Use your own DeepSeek and Gemini web sessions as DSH models.'),
        ),
        h('div', { className: 'dws-meta' },
          h('span', null, 'bridge: ', h('code', null, status.baseURL || 'not listening')),
          status.bridgeError ? h('span', { className: 'dws-msg dws-msg--danger' }, status.bridgeError) : null,
          h('span', null, 'browser: ', h('code', null, status.browser ? status.browser.kind : 'none')),
        ),
        Object.keys(PROVIDER_COPY).map((provider) =>
          h(ProviderCard, {
            key: provider,
            provider,
            entry: providers[provider],
            onChanged: refresh,
          }),
        ),
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
