# Transferência operacional — preparação concluída

Este pacote continua `audit/orulo-national-v2` a partir de `a46a508c3205e1af3ce44dcc48f118d63fcbf8cf`. **Work só preparou código, documentação e testes sintéticos.** A origem e o banco serão consultados separadamente no ambiente ChatGPT operacional autorizado. Nenhuma confirmação intermediária é necessária para seguir as leituras já autorizadas; operações fora desse escopo continuam vedadas.

O pacote é privado. Não abrir PR público, publicar os artefatos, subir a nova revisão para o repositório público ou enviar valores secretos no chat. O commit de preparação é local; a entrega é por arquivo privado. O histórico da revisão anterior é preservado, não tratado como autorização de publicação futura.

## Conteúdo pronto para transferência

| Artefato | Uso |
|---|---|
| `manifest/national-v2.json` | Manifesto preliminar original, sem alteração de bytes |
| `manifest/manifest.sha256` | SHA-256 original do manifesto |
| `handoff/source-queue.json` | 17.011 pares empreendimento/planta deduplicados; 56.754 associações com 7.284 UUIDs em 2.667 empreendimentos |
| `handoff/source-queue.sha256` | Hash da fila de descoberta, associada ao manifesto |
| `scripts/orulo-national-source-readonly.mjs` | OAuth e GET oficiais; validação de resposta, IDs, URLs, MIME e assinatura; evidências/checkpoints locais |
| `scripts/orulo-national-export-readonly.py` | Exportação SQL com `BEGIN READ ONLY`, linhas canônicas e conferência global |
| `scripts/orulo-national-simulate.mjs` | Junção offline de origem, hashes atuais e helpers existentes; nenhuma chamada CAS |
| `scripts/orulo-national-operational-readonly.sh` | Executa etapas de leitura independentes e registra seus códigos de saída |
| `handoff/eligibility.md` | Critérios de elegibilidade diagnóstica, exclusão e pendências obrigatórias |
| `handoff/issues.json` e `handoff/risks.md` | Ocorrências classificadas por escopo e evidências |
| `handoff/PACKAGE-SHA256SUMS` | Integridade dos arquivos do pacote, scripts e protocolo de referência |
| `handoff/protocol-reference.json` | Hashes dos arquivos do protocolo existente, mantidos sem alteração |

SHA-256 do manifesto: `f94cf3139fa2516d55b98c0e242c64193107f0f65be924f36c936dc7952ab070`.

SHA-256 da fila: `b6726aa08aca9673e4d76d10e405b071682b1c8ed88a8ce93a934392b814f11e`.

## 1. Receber e conferir

Extrair o arquivo privado de transferência e entrar no diretório `repository/` extraído. Ele contém o código completo necessário, inclusive os helpers originais. Não é necessário instalar uma nova versão do protocolo ou aplicar migrations.

```bash
cd /caminho/privado/extraido/repository
sha256sum -c orulo-national-v2/handoff/PACKAGE-SHA256SUMS
python3 scripts/orulo-national-v2.py verify orulo-national-v2
(cd orulo-national-v2/manifest && sha256sum -c manifest.sha256)
(cd orulo-national-v2/handoff && sha256sum -c source-queue.sha256)
```

O arquivo externo `orulo-national-v2-transfer.tar.gz.sha256` permite conferir o arquivo recebido antes da extração. Verificar o hash contra a entrega privada original; checksums armazenados junto dos arquivos não substituem a confiança na origem da entrega.

Para integrar o bundle a um clone existente, sem publicação:

```bash
git cat-file -e a46a508c3205e1af3ce44dcc48f118d63fcbf8cf^{commit}
git bundle verify /caminho/privado/extraido/transfer.bundle
git fetch /caminho/privado/extraido/transfer.bundle refs/heads/audit/orulo-national-v2:refs/heads/audit/orulo-national-v2-handoff
git switch audit/orulo-national-v2-handoff
sha256sum -c orulo-national-v2/handoff/PACKAGE-SHA256SUMS
```

Esse bundle tem `a46a508` como pré-requisito. Se o clone não o contiver, obter esse commit já existente pelo acesso autorizado ao GitHub ou usar o diretório `repository/` do arquivo privado. Não executar `git push`.

## 2. Verificar as capacidades do ambiente operacional

Requisitos do runner: Node.js 22+, Python 3.9+, Bash, `sha256sum` e, para a exportação automática, `psql`. Conexões existentes devem estar vinculadas ao projeto Supabase **`wzaegidwtdjuhqchpdpd`** e à conta Órulo autorizada. Verificar a identidade do serviço libpq antes de usá-lo; o script registra a identidade como declaração do chamador, não como atestação automática do banco.

As únicas credenciais lidas pelo script de origem são `ORULO_CLIENT_ID` e `ORULO_CLIENT_SECRET`, injetadas pelo mecanismo seguro já autorizado no ambiente operacional. Nenhum script lê valores da Vercel, cria credenciais, altera Environment/secrets, ou extrai segredos de workflow. Não digitar valores em argumentos de comando ou arquivos versionados. `MIA_READ_TOKEN` não é necessário para a rota direta implementada.

Para o banco, usar um perfil libpq já configurado e autorizado, como `orulo_readonly`, com segredo fora do repositório. Os scripts não criam esse perfil, não alteram roles/RLS e não recebem URLs ou senhas como argumentos. Se houver apenas o conector Supabase, seguir a alternativa MCP abaixo. A ausência de uma capacidade bloqueia somente as etapas que dependem dela; continuar as verificações offline e leituras independentes.

## 3. Executar descoberta e dry run de leitura

**Executar os próximos comandos somente no ambiente operacional**, nunca no Work. Escolher diretório privado novo fora do checkout. O wrapper valida os hashes antes de chamar qualquer serviço e não possui opção de escrita.

```bash
bash scripts/orulo-national-operational-readonly.sh \
  --service orulo_readonly \
  --output-dir /caminho/privado/novo/orulo-national-v2-run
```

O wrapper consulta a origem, exporta o banco mesmo se a origem estiver bloqueada e só simula quando existem as entradas necessárias. Retorno `0` significa que as etapas diagnósticas terminaram e os checks locais passaram; **não significa GO, elegibilidade de produção ou autorização**. Retorno `2` significa parcial/bloqueado: ler `stage-results.tsv`, os relatórios por empreendimento e `incidents.json`. Uma falha do wrapper não justifica despachar um workflow de escrita.

Comandos equivalentes para executar etapas independentemente:

```bash
node scripts/orulo-national-source-readonly.mjs \
  --queue orulo-national-v2/handoff/source-queue.json \
  --queue-sha256 b6726aa08aca9673e4d76d10e405b071682b1c8ed88a8ce93a934392b814f11e \
  --output-dir /caminho/privado/novo/source

python3 scripts/orulo-national-export-readonly.py \
  --service orulo_readonly \
  --output-dir /caminho/privado/novo/rows

node scripts/orulo-national-simulate.mjs \
  --manifest orulo-national-v2/manifest/national-v2.json \
  --queue orulo-national-v2/handoff/source-queue.json \
  --queue-sha256 b6726aa08aca9673e4d76d10e405b071682b1c8ed88a8ce93a934392b814f11e \
  --rows-dir /caminho/privado/novo/rows \
  --recheck /caminho/privado/novo/rows/recheck.json \
  --source-dir /caminho/privado/novo/source \
  --output-dir /caminho/privado/novo/dry-run
```

Os três comandos acima não devem usar o mesmo caminho literal `novo` de uma execução anterior. Não sobrescrever evidências. O exportador mantém somente hashes em memória entre páginas; os registros integrais ficam em arquivos privados. A simulação carrega o snapshot local; memória e espaço necessários devem ser medidos no runner e classificados `UNKNOWN` até essa medição.

### Retomada da descoberta

`--max-buildings 100` limita apenas uma janela de observação, conservando a mesma fila e o mesmo lote lógico. Após uma janela parcial, executar o mesmo comando com o mesmo diretório e `--resume`; os empreendimentos já tentados não são repetidos. O limite é opcional; o padrão percorre toda a fila.

```bash
node scripts/orulo-national-source-readonly.mjs \
  --queue orulo-national-v2/handoff/source-queue.json \
  --queue-sha256 b6726aa08aca9673e4d76d10e405b071682b1c8ed88a8ce93a934392b814f11e \
  --output-dir /caminho/privado/source-existente \
  --max-buildings 100 --resume
```

Falhas 401/403/429 da API/OAuth e 429 do CDN são bloqueios compartilhados; não há retry automático nem retomada desse run bloqueado. Preservar evidências, diagnosticar a causa, respeitar `Retry-After` e iniciar outro diretório de observação somente após resolver o bloqueio. Isso não é uma nova autorização ou um novo lote de escrita.

Falha localizada de fonte/URL bloqueia o alvo e permite examinar os demais. Evidência de empreendimento interrompido é preservada e colocada em quarentena (`UNKNOWN`); os demais continuam. Se um processo morrer e deixar `.discovery.lock` ou `index.json.tmp`, classificar o armazenamento local como `UNKNOWN`; confirmar que o processo acabou, preservar os arquivos e usar uma nova janela privada. Não apagar evidências para forçar o sucesso. Esses arquivos locais não são o ledger de produção.

## 4. Alternativa com o conector Supabase

Sem `psql`, usar `execute_sql` do conector existente com `project_id="wzaegidwtdjuhqchpdpd"`. Não invocar uma RPC de auditoria para realizar a exportação, pois o início/captura de um run pode gravar no ledger.

1. Ler `sql/operational-dry-run-rows.sql`. Substituir `__AFTER__` por `00000000-0000-0000-0000-000000000000` e `__LIMIT__` por `100`. Executar exatamente o SQL `BEGIN READ ONLY ... COMMIT`.
2. Salvar o array do campo `rows` em `rows/page-000001.json`. Também é aceito o envelope `[ {"rows": [...] } ]` fornecido pelo conector, depois de remover apenas o texto delimitador da ferramenta. Não concatenar JSON como texto nem arredondar números do campo `recordCanonical`.
3. Usar o último `id` como cursor da próxima consulta; salvar `page-000002.json` e assim por diante, em ordem. Encerrar quando a página tiver menos de 100 registros. Se a ferramenta truncar a resposta, não a usar; diminuir o limite e refazer a exportação em outro diretório. Manter os nomes com seis dígitos.
4. Executar `sql/operational-recheck.sql` e salvar o objeto JSON do campo `recheck` em `rows/recheck.json`. O envelope `[ {"recheck": {...} } ]` também é aceito pela CLI. Não reutilizar `audit/inputs/recheck.json` do levantamento antigo.
5. Rodar a simulação offline com esses arquivos. Ela valida hashes de cada linha, unicidade/ordem de UUID, quantidade e fingerprint global. Snapshot incompleto ou alterado durante a coleta bloqueia a simulação; descoberta e documentação independentes podem continuar.

Se o ambiente ChatGPT não tiver um runner Node e apenas conectores, o coletor de origem ainda não poderá ser executado: registrar `BLOCKER` por capacidade ausente e transferir os mesmos scripts para um runner autorizado. Não alterar um workflow protegido, remover gates de main/proprietário, adicionar permissões, implantar um endpoint ou publicar segredos para contornar essa condição.

## 5. Interpretar e encerrar a etapa de leitura

Ler `dry-run/simulation.json`, `incidents.json`, `source/index.json`, os `buildings/<id>/result.json` e `rows/snapshot-index.json` quando gerado pelo exportador. Os arquivos `source/index.json.sha256` contêm o hash puro do índice; os resultados dos empreendimentos e evidências CDN são verificados pela simulação.

`RECOVERABLE` é classificação diagnóstica da fonte e do patch local, nunca uma liberação operacional. O resultado global de produção permanece `UNKNOWN`, `productionEligible=false`, `writeAuthorized=false` e `realCASCalls=0`. Os modelos locais de idempotência, concorrência e rollback não substituem as transações, triggers e comparações PostgreSQL do protocolo.

Se houver drift, excluir os registros alterados e registrar os novos/ausentes para novo manifesto preliminar revisado, sem transplantar hashes do levantamento antigo. Não modificar a fila congelada durante uma execução. Manter o manifesto mestre único; uma nova versão da fila deve ter novo hash e nova evidência de origem.

Preparar o relatório de leitura com contagens medidas, exclusões, incidentes e tempos reais da janela. O índice registra contagem de requisições, tempo até headers, início/fim e hashes dos resultados. Tamanho/tempo/limites desconhecidos permanecem `UNKNOWN`. Emitir recomendação de segmentos físicos somente após essas medições, sem inventar dezenas de lotes.

**Parar antes da execução real.** Não fornecer estes patches diretamente às RPCs atuais: o catálogo existente não contempla o lote nacional; hashes SHA-256 deste pacote não são os MD5 V2 do protocolo anterior; a autorização, baseline e snapshots obrigatórios continuam ausentes. Nenhum comando deste pacote executa migrations, CAS real, `WRITE_AUTHORIZED`, workflow operacional, merge ou deploy.
