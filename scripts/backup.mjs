// dsh-web-sub — backup script
// Packages the plugin into D:\Vity_Backups\extensoes\dsh-web-sub, computes SHA256,
// runs restoration verification tests on the zip, and updates MANIFESTO.txt.

import { cpSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execSync } from 'node:child_process'

const root = dirname(fileURLToPath(new URL('../package.json', import.meta.url)))
const backupDir = 'D:\\Vity_Backups\\extensoes\\dsh-web-sub'

if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true })
}

const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
const now = new Date()
const pad = (n) => String(n).padStart(2, '0')
const dateStr = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
const timeStr = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
const timestamp = `${dateStr}_${timeStr}`
const zipName = `dsh-web-sub_v${pkg.version}_${timestamp}.zip`
const zipPath = join(backupDir, zipName)

const ENTRIES = ['package.json', 'cordis.patch.yml', 'README.md', 'lib', 'src', 'scripts', 'tests', 'assets', 'bin', 'docs', 'locale']

// Stage files
const stageDir = mkdtempSync(join(backupDir, 'stage-'))
try {
  for (const entry of ENTRIES) {
    const src = join(root, entry)
    if (existsSync(src)) {
      cpSync(src, join(stageDir, entry), { recursive: true })
    }
  }

  // Create zip using powershell Compress-Archive
  execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${stageDir}\\*' -DestinationPath '${zipPath}' -Force"`, { stdio: 'inherit' })
} finally {
  rmSync(stageDir, { recursive: true, force: true })
}

// Compute hash and size
const hash = createHash('sha256').update(readFileSync(zipPath)).digest('hex').toUpperCase()
const sizeKb = (statSync(zipPath).size / 1024).toFixed(1)

console.log(`\nBackup criado com sucesso:`)
console.log(`  Arquivo : ${zipName}`)
console.log(`  Pasta   : ${backupDir}`)
console.log(`  Tamanho : ${sizeKb} KB`)
console.log(`  SHA-256 : ${hash}`)

// Test restoration
console.log('\nVerificando integridade da restauracao...')
const testDir = mkdtempSync(join(backupDir, 'test-restore-'))
try {
  execSync(`powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${testDir}' -Force"`, { stdio: 'pipe' })
  execSync(`node --check "${join(testDir, 'lib', 'index.js')}"`, { stdio: 'pipe' })
  execSync(`node "${join(testDir, 'tests', 'selftest.mjs')}"`, { stdio: 'inherit' })
  console.log('Restauracao verificada com sucesso! Todos os testes passaram.')
} finally {
  rmSync(testDir, { recursive: true, force: true })
}

// Update MANIFESTO.txt
const manifestoPath = join(backupDir, 'MANIFESTO.txt')
const manifestoContent = `BACKUP DO PLUGIN dsh-web-sub
=====================================================
Versao          : ${pkg.version}
Data do backup  : ${pad(now.getDate())}/${pad(now.getMonth() + 1)}/${now.getFullYear()} ${pad(now.getHours())}:${pad(now.getMinutes())}
Origem          : ${root}
Arquivo         : ${zipName}
Tamanho         : ${sizeKb} KB
SHA-256         : ${hash}

O QUE E
-----------------------------------------------------
Plugin do DeepSeek Harness que usa as sessoes web de
chat.deepseek.com e gemini.google.com como modelos
de API dentro do DSH, via ponte local em 127.0.0.1:18431.

CONTEUDO
-----------------------------------------------------
package.json, cordis.patch.yml, README.md
INSTALACAO_MANUAL.md   <- leia este primeiro
lib/     codigo compilado (pronto para uso)
src/     codigo-fonte
scripts/ build.mjs, install.mjs e backup.mjs
tests/   selftest.mjs
assets/  sha3_wasm_bg.wasm (proof-of-work do DeepSeek)
bin/     CLI dsh-web-sub
docs/    INSTALL.md
locale/  textos da interface

Sem node_modules (nao ha dependencias).

NOVIDADES DA 0.5.0
-----------------------------------------------------
1. TOOL CALLING SINTETICO / CONTROLE DO PC:
   Suporte nativo a execucao de ferramentas no DeepSeek Harness.
   O bridge agora intercepta blocos <tool_call> emitidos pelo
   modelo (Gemini ou DeepSeek) e os converte em eventos oficiais
   de tool_calls do padrao OpenAI (com finish_reason: tool_calls).
   Permite rodar comandos no terminal/PowerShell, ler/escrever
   arquivos e operar como agente autonomo completo no Windows.
2. SUPORTE TOTAL AO GEMINI 4 ARGON:
   Conectado e validado com 1 Milhao de tokens de contexto
   (1048576 tokens) e suporte completo a execucao de ferramentas.
3. CONVERSACAO REATIVADA & RECONSTRUCAO DE HISTORICO:
   Formatacao de chamadas anteriores do assistente e retornos
   [TOOL RESULT] preservados entre os turnos de execucao.

NOVIDADES DA 0.4.0 (incluida)
-----------------------------------------------------
1. NIVEL DE RACIOCINIO: todo modelo publica os niveis
   low e high via reasoningEfforts. low = pensamento
   padrao; high = extended thinking (Gemini) e DeepThink
   (DeepSeek). O seletor aparece no compositor do DSH.
2. O modelo separado "Gemini (Extended Thinking)" saiu;
   virou o nivel high de cada modelo.
3. A ponte aceita reasoning_effort, reasoning.effort e
   o booleano thinking de qualquer cliente.

CORRECAO DA 0.3.1 (incluida)
-----------------------------------------------------
O slot de credencial recebia o cookie CRU e o DSH
recusava o provedor com "the API key ... contains
characters no HTTP header can carry". Agora o slot
guarda apenas um token opaco (dsh-web-sub-bridge-token)
e o cookie fica somente no accounts.json.

CREDENCIAIS - IMPORTANTE
-----------------------------------------------------
Este ZIP NAO contem suas credenciais. O token/cookie
das contas fica em:
  %USERPROFILE%\\.dsh\\dsh-web-sub\\accounts.json  (0600)
Ao restaurar em outra maquina, reconecte a conta pela
secao 4 do INSTALACAO_MANUAL.md (leva menos de 1 minuto).

TESTE DE RESTAURACAO
-----------------------------------------------------
O ZIP foi extraido em pasta limpa e submetido a:
  node --check lib\\index.js       -> sintaxe OK
  node tests\\selftest.mjs         -> all checks passed
O pacote restaura e funciona sem a pasta de desenvolvimento.

INSTALACAO RAPIDA
-----------------------------------------------------
1. Extraia o ZIP.
2. Copie a pasta para:
   C:\\Users\\ricar\\.dsh\\profiles\\desktop\\node_modules\\dsh-web-sub
3. Confirme no cordis.patch.yml do perfil:
   - insert:
       - id: web-subscription
         name: 'dsh-web-sub'
4. Reinicie o DeepSeek Harness.
5. Conecte a conta (secao 4 do INSTALACAO_MANUAL.md).

Detalhes, verificacao e solucao de problemas:
  INSTALACAO_MANUAL.md (nesta mesma pasta)
`
writeFileSync(manifestoPath, manifestoContent, 'utf-8')
console.log(`Manifesto atualizado em: ${manifestoPath}`)
