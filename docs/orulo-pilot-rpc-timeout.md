# Incidente 41840098939: pilot_targets statement_timeout

## Causa comprovada

Main/commit aprovado: ee9b114535c57a020e3d73b8a37c9a4673f66c5f.
Run 41840098939, UUID bcc8512e-87c3-46dd-9f0c-8e6a27172f73, terminou no GitHub
como completed/failure. O gate passou. START foi confirmado às
2026-11-04 13:39:56.477210 UTC; o PostgreSQL registrou `canceling statement due to
statement timeout` às 13:40:04.854 UTC; CLIENT_STOP foi confirmado às 13:40:05.319056.

A falha foi na primeira consulta **pilot_targets**, não em autorização ou CAS.
O executor chama essa ação imediatamente depois de abrir/verificar START. O erro
PostgREST mostra somente os parâmetros p_action/p_run; pilot_row incluiria p_event
e read incluiria p_sequence. Nenhum PILOT_PLAN foi emitido. START e STOP funcionaram,
confirmando autenticação/assinatura da RPC. A evidência PostgreSQL é timeout, não
PGRST schema cache, validação ou permission denied.

A função instalada pelo PR #85 filtra:

```sql
coalesce(raw_data->>'building_id',raw_data->'building'->>'id')='43126'
```

Essa expressão não coincide com o índice existente sobre raw_data->>'building_id'.
EXPLAIN sob orulo_audit_owner confirmou Seq Scan do inventário. Dados grandes em
raw_data tornam essa procura lenta mesmo quando o resultado contém apenas 18 UUIDs.
O PR #86 mudou apresentação/autorização manual; não alterou essa função SQL.
Os testes anteriores de lookup usavam poucos imóveis; o ensaio grande cobria os
snapshots, não a seleção operacional do building.

## Correção mínima

Migração aditiva 20261104135027_orulo_pilot_indexed_targets.sql substitui apenas o
helper privado: duas consultas disjuntas com UNION ALL, uma para ID principal igual
a 43126, outra para ID principal NULL e ID aninhado igual a 43126. Ambas usam
active IS TRUE/source=novos e o índice parcial já existente. Preserva exatamente
COALESCE, inclusive NULL JSON, campo ausente, string vazia e IDs conflitantes.

EXPLAIN ANALYZE somente leitura em produção da consulta equivalente, sob o mesmo
owner: dois Index Scan usando properties_portal_building_id_idx, 18 UUIDs e
**10.990 ms de execução**, sem Seq Scan. A função de produção ainda não foi
substituída por esta tarefa: a correção está em PR para revisão/instalação explícitas.

Não cria índice, muda timeout, introduz retries, altera escopo, RLS, ACL, autorização,
CAS ou propriedades. A RPC e sua assinatura permanecem iguais. O transporte passa
a registrar somente RPC/ação/status HTTP/SQLSTATE (ou PGRST code), sem imprimir
message/details/hint que podem conter dados privados. Esses campos seguros também
ficam em CLIENT_STOP. A mensagem genérica anterior ocultava a ação e a causa.

## Reconciliação autorizada

Foi comprovado o estado exato: dois eventos START/CLIENT_STOP, SHA-256/canonical e
ligações válidos, confirmedRows=0/id=null, nenhuma autorização/INTENT/CAS e nenhum
INTENT pendente global. Os 18 UUIDs e hashes completos permaneceram iguais à
referência confiável outputs/orulo-pilot-producao-preparacao.json, capturada antes
da tentativa. A mesma comparação foi exigida novamente dentro do procedimento.

`supabase/orulo_reconcile_41840098939.sql` foi testado e executado sob autorização
do proprietário. Apenas ABORTED foi acrescentado como evento 3; os dois originais
ficaram intactos. Novo head:
`2db4054134ff4fe2e3f93161785f87c70bea88f19db0fba2ef53f31cfe6fc6be`.
Mudança de hash, evento extra, propriedades alteradas ou repetição rejeitam a operação.
A execução 41832262256 permanece com seus quatro eventos e mesmo head anterior;
não foi modificada novamente.

## Validação e próxima tentativa

SQL/client regressions cobrem timeout antes de PILOT_PLAN, START/STOP duráveis,
zero CAS/propriedades intactas, diagnóstico redigido, reconciliação e rejeição de
repetição. PostgreSQL nativo cobre 21.646 linhas, igualdade de resultados, fallback
NULL/ausente, string vazia/conflito, filtros SP/novos/ativo e plano indexado real;
valida que o helper segue privado. Nenhum serviço de produção é escrito nos testes.

Revisar/integrar o PR e instalar a migração corretiva antes de nova tentativa.
Depois atualizar o SHA aprovado conforme o commit revisado. Nova execução e
WRITE_AUTHORIZED exigem liberação própria; não foram emitidas nesta tarefa.
Somente building 43126 continua candidato. Não há liberação dos outros 98 IDs.
