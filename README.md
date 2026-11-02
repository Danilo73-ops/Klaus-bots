# Klaus-bots

Repositório único de bots de vídeo para Termux. Cada site tem sua integração em `bots/`; o núcleo comum guarda a fila e controla as transições de estado.

**Estado atual:** núcleo de fila, lock de processo e coletor FLUX implementados. A geração FLUX ainda está desativada, aguardando análise do executor e do diagnóstico atual do celular. Não há comando de geração nesta versão.

## Organização

| Caminho | Responsabilidade |
| --- | --- |
| `klaus.py` | Entrada dos comandos e lock mantido pelo kernel |
| `core/queue.cjs` | Fila persistente, backups, barreira de envio e validação de resultados |
| `core/cli.cjs` | Importação local e consulta da fila |
| `bots/fal-flux-max/` | Configuração e diagnóstico do Playground FLUX |
| `tests/` | Testes locais sem consumo de gerações |

O código usa Node.js 24, Python 3 e FFprobe. Os comandos já disponíveis não precisam de instalação npm. A automação de interface existente usa Playwright Core; sua recuperação depende do diagnóstico do Chromium original.

## Comandos disponíveis

Listar integrações:

```bash
# Bash / listar-sites.sh / Termux / Klaus-bots
python3 klaus.py sites
```

Consultar a fila nova, sem alterar a fila antiga:

```bash
# Bash / status.sh / Termux / Klaus-bots
python3 klaus.py status fal-flux-max
```

Coletar código, estados e condições atuais da interface do projeto antigo:

```bash
# Bash / diagnostico.sh / Termux / Klaus-bots
python3 klaus.py diagnostico fal-flux-max
```

O coletor faz leitura, não clica e não inicia Chromium. Mesmo com a porta 9261 indisponível, gera um ZIP com os arquivos e o erro observado. Exclui perfil, cookies, `.env`, vídeos e backups; filtra campos conhecidos de credenciais das cópias de texto.

Importar um lote **apenas para a fila nova local**:

```bash
# Bash / importar.sh / Termux / Klaus-bots
python3 klaus.py importar fal-flux-max /caminho/absoluto/lote.json
```

O JSON precisa ter `schema: 1`, `bot: "fal-flux-max"`, `parameters` com os valores do manifesto e `jobs`, um array de objetos com `id` e `prompt`. Cada prompt deve ser o texto integral. Reimportar um lote idêntico é uma operação sem alterações; reutilizar um ID com outro texto ou parâmetros é recusado.

Este importador não migra `state.json`, `estado.json` ou jobs 71–95 automaticamente. A migração precisa preservar os descartes de 71/72 e reconciliar o estado atual antes de liberar qualquer envio.

## Persistência e envio

Os dados locais ficam por padrão em `$HOME/.local/share/klaus-bots/<bot>/`, fora do checkout. `KLAUS_DATA_DIR` permite outro diretório, também fora do repositório. Backups de estado são feitos antes de substituir `queue.json`. A gravação usa arquivo temporário, `fsync` e renomeação.

O launcher mantém um `flock` por bot no mesmo processo que executa o Node. O kernel libera esse lock quando o processo termina, inclusive por signal 9. Um lock ocupado significa outra operação local; não significa geração no fal.ai.

| Estado | Condição para seguir |
| --- | --- |
| `pending` / `prepared` | A barreira de envio ainda não foi atravessada |
| `submitting` | Intenção gravada antes de qualquer ação capaz de enviar |
| `uncertain` | Consultar a solicitação real; reenvio proibido |
| `queued` / `running` | Request ID confirmado para a tentativa atual |
| `result_ready` / `downloading` | Resultado vinculado ao mesmo Request ID |
| `completed` | MP4 local validado com FFprobe |
| `rejected_content` | Rejeição confirmada para a tentativa; retirar o prompt e avançar |
| `failed_remote` / `discarded` | Terminal, sem reenvio automático |

Ao retomar, uma tentativa interrompida em `submitting` vira `uncertain`. O núcleo bloqueia o próximo envio enquanto uma solicitação estiver ativa ou incerta. Um erro anterior à barreira pode retornar a `pending`; um timeout após a barreira nunca retorna a `pending`.

O contrato do núcleo correlaciona respostas por ID da tentativa e Request ID. Cabe à integração do site obter essa evidência dos eventos reais. Texto antigo na página ou existência de um processo não serve como prova. O núcleo não consulta servidores sozinho.

## Situação do FLUX

Parâmetros fixados no manifesto: 15 segundos, 720p, 9:16, áudio ativado e reasoning high. A política é `free-only`.

A execução só será habilitada depois de confirmar a oferta gratuita da conta e implementar o bloqueio de solicitações fora dela. A API pública documentada não prova que a promoção do Playground se aplica à API. Esta versão não envia requisições de geração nem cria contas.

O projeto original em `$HOME/klaus-fal-robo-v1`, seu perfil e os MP4 em `Download/KLAUS AUT. FLUX MAX` continuam sendo a fonte para a recuperação. Os comandos desta versão não reiniciam esse projeto nem o Klaus OS.

## Testes

```bash
# Bash / testes.sh / Termux Linux / Klaus-bots
npm test
```

Os testes cobrem deduplicação, estados incertos, rejeição correlacionada, retomada, conservação de dados inválidos, validação de vídeo e liberação do lock após SIGKILL. Não comprovam uma execução no fal.ai. A prova final continua sendo gerar um job autorizado, baixar, validar e avançar para o seguinte no Android.

## Dados no GitHub

O repositório estava público ao iniciar esta versão. Foram incluídos código, configuração e testes; nenhum lote privado ou diagnóstico do celular. Para manter prompts inéditos no GitHub, torne o repositório privado antes de publicá-los. `.gitignore` não remove dados que já tenham sido commitados.

Novos sites seguem o contrato de [INTEGRACOES.md](INTEGRACOES.md).
