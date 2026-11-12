# Arquivamento Órulo — preparação segura do PR #112

Esta versão implementa exportação, verificação independente, restauração **lógica** em PostgreSQL local e simulação de limpeza. Nenhuma exportação de dados de produção ou limpeza foi executada. A interface durável está implementada; seu destino ainda não foi comprovado. Não altera manifesto nacional, V4, CAS, RLS ou privilégios.

## Evidência real e limites

A inspeção MCP executou exclusivamente SELECT em `BEGIN READ ONLY`, com timeout. Foram encontrados 23 runs (4 FINISHED, 19 ABORTED), 7.732 entries e 348.344 snapshot_records. Não há run sem terminal no instante da consulta; isso não comprova ausência de execução futura. Inventário: `docs/orulo-archive-inventory.json`; dependências: `docs/orulo-archive-dependencies.json`; simulação: `docs/orulo-archive-eligibility.json`. As consultas reproduzíveis estão neste diretório. Todas as execuções permanecem bloqueadas para descarte.

**Dependências comprovadas:** `orulo_audit.batch_prerequisite_result(text)` referencia literalmente `28c6cb35-06da-4eb1-ab56-cf5b27dfaa5a` e `8c3b6881-69fa-4737-a29f-6aeebe1b94b9`. A função valida suas cadeias, reconciliações e recibos CAS diretamente no banco. Remover esses dados quebraria o protocolo existente. Zero INTENT sem CAS_RESULT no agrupamento por operation_uuid observado não prova conclusão de aprovações humanas, recuperação nacional ou dependências dinâmicas. Essa revisão permanece BLOCKED.

Todas as quatro tabelas possuem RLS forçada e triggers `immutable_rows`/`immutable_table`. A função `immutable()` rejeita UPDATE/DELETE/TRUNCATE com `AUDIT_APPEND_ONLY`. Nenhum desses controles será desabilitado. A remoção exige um mecanismo de retenção compatível com o protocolo, ainda não autorizado nem implementado nesta versão. Não basta conceder permissões ou marcar um run como antigo.

## Exportação local por execução

Em ambiente autorizado, preparar um serviço libpq existente com TLS e acesso integral ao schema. Não fornecer senha/URI em argumentos. Definir `PGSERVICEFILE`/`PGPASSFILE` privados (0600). Não usar `SUPABASE_SECRET_KEY` como substituto de conexão PostgreSQL. Não copiar perfis para o PR ou artifacts.

```bash
python3 -m venv /tmp/orulo-archive-venv
/tmp/orulo-archive-venv/bin/pip install -r scripts/orulo-audit-archive/requirements.txt
umask 077
/tmp/orulo-archive-venv/bin/python scripts/orulo-audit-archive/export.py \
  --service '<servico-libpq-autorizado>' --run '<run_uuid>' \
  --output '<diretorio-privado-da-execucao>'
/tmp/orulo-archive-venv/bin/python scripts/orulo-audit-archive/verify.py '<diretorio-privado-da-execucao>'
```

O exportador usa uma transação REPEATABLE READ READ ONLY, UTC, cursores de servidor e arquivos `.partial` publicados atomicamente. `row_security=off` é apenas uma configuração LOCAL da sessão: se RLS filtraria dados, PostgreSQL gera erro em vez de exportar subconjunto. Não altera nenhuma política. Esquema divergente, run inexistente/oculto ou não encerrado bloqueia a exportação.

Cada tabela vai para JSONL separado: runs, entries, snapshot_sets, snapshot_records. Campos seguem o contrato tipado versionado e a representação textual PostgreSQL; canonical, JSONB, xid8 e timestamps não são reconstruídos pelo exportador. `catalog.json` preserva tipos, definições de funções, constraints, triggers e políticas; contém material privado. O manifesto registra contagens, bytes, SHA-256, cabeça da cadeia e os estados ainda não comprovados.

Para retomar, repetir o comando no mesmo diretório. A tabela interrompida é reiniciada, mantendo memória limitada; arquivos completos são relidos da origem e comparados por hash antes de reutilização. Não é retomada por offset. Mudança na origem ou catálogo bloqueia a reutilização. A origem deve ser revalidada de novo antes de uma futura remoção: uma exportação consistente não é um lock permanente. O arquivo `.lock` impede dois exportadores locais simultâneos.

## Verificação e preservação durável

`verify.py` não importa o exportador. Recalcula hashes/contagens; verifica cadeia, canonical/event/IDs, terminal, ordem, unicidade, chaves de snapshots e conteúdo dos registros contra os eventos SNAPSHOT_PAGE. Usa SQLite temporário para os índices, não mantém o banco inteiro na memória. Detecta referências a runs em eventos e literais de funções; a revisão de dependências dinâmicas e fechamento transitivo é obrigatória e não automatizada. `contentVerified` NÃO equivale a arquivo durável restaurado nem a autorização para exclusão.

A interface `durable.py` admite S3 privado com versionamento, Public Access Block completo e Object Lock COMPLIANCE mínimo de 365 dias. Usa credenciais existentes da cadeia padrão AWS; não cadastra credenciais, bucket ou política. Verifica a privacidade e configuração antes do upload; falha se não puder comprová-las. Objetos são criados com `IfNoneMatch=*`, cifrados no servidor, com retenção; cada versão é baixada e comparada. Uma segunda cópia baixada passa pelo verificador independente. O receipt privado contém versões e hashes.

```bash
/tmp/orulo-archive-venv/bin/python scripts/orulo-audit-archive/durable.py \
  '<diretorio-privado-da-execucao>' --bucket '<bucket-privado-existente>' \
  --prefix '<prefixo-novo-exclusivo>'
```

**BLOCKED:** nenhum destino/cópia durável real comprovado. O adapter não foi executado contra armazenamento real. Depois de upload parcial, usar prefixo novo: objetos existentes nunca são sobrescritos. Falta de política de bucket consultável ou qualquer erro deve bloquear. Renovar retenção antes do vencimento enquanto houver dependências; 365 dias não é autorização para expirar provas. GitHub artifacts não substituem essa cópia. Os scripts/workflow não publicam dumps privados como artifacts.

## Restauração PostgreSQL realmente isolada

A ferramenta não aceita URI remota. Exige container local rotulado e porta restrita a 127.0.0.1; alvo não vazio é rejeitado. Recria tabelas tipadas com PK/FK/checks do contrato, insere todos os campos e compara hashes/contagens da leitura PostgreSQL com os arquivos originais. Isso comprova restauração **dos dados**; não reinstala funções/owners/policies/triggers de produção nem autoriza reativação do CAS. O catálogo e migrations versionadas permanecem necessários a uma recuperação operacional revisada.

```bash
docker run --detach --rm --name orulo-archive-isolated \
  --label orulo.archive.isolated=true -e POSTGRES_HOST_AUTH_METHOD=trust \
  -p 127.0.0.1::5432 \
  postgres:17.6@sha256:00bc86618629af00d2937fdc5a5d63db3ff8450acf52f0636ec813c7f4902929
# Aguardar pg_isready antes de continuar.
/tmp/orulo-archive-venv/bin/python scripts/orulo-audit-archive/restore.py \
  '<copia-privada-baixada-do-armazenamento>' --container orulo-archive-isolated
# Guardar a saída privada associada ao SHA do manifesto; destruir o container depois.
docker rm -f orulo-archive-isolated
```

A restauração real desta tarefa usou dados sintéticos no mesmo PostgreSQL 17.6. **Nenhum dos 23 runs reais tem restauração comprovada.** Cada um precisa passar pelo mesmo processo com a cópia durável baixada, alvo novo e relatório assinado/retido fora do PR. A comparação byte a byte pode bloquear sob versão/locale/serialização diferentes; não contornar usando equivalência presumida.

## Simulação e executor desabilitado

```bash
DRY_RUN=true python3 scripts/orulo-audit-archive/cleanup.py \
  docs/orulo-archive-inventory.json
```

`DRY_RUN` é true por padrão. `--execute`, DRY_RUN=false e allowlists não habilitam DML. Esta versão não contém conexão PostgreSQL de limpeza nem uma rotina que contorne append-only. O plano prevê aprovação explícita por UUID, revalidação imediata da cabeça/contagens/dependências a cada lote, lock global compatível com recuperação seguido de lock do run, máximo de 100 linhas por transação, interrupção em divergência e diário externo imutável. A implementação destrutiva e sua autorização ficam BLOCKED até resolver o contrato de retenção. Não remover runs enquanto snapshots, aprovações, reconciliações, funções ou recuperação dependerem deles. Proibido atingir public.properties/public.events.

## Workflow seguro

`.github/workflows/orulo-audit-archive-safe.yml` executa apenas testes sintéticos/restauração local e dry run do inventário. Não injeta secrets, não usa ambiente de produção e não exporta produção automaticamente. Um novo disparo dessa validação não é arquivamento operacional. `vercel.json` exclui somente `codex/orulo-audit-archive-preflight` de deployments Git automáticos; demais branches mantêm o comportamento. Não fazer merge deste PR nesta tarefa.
