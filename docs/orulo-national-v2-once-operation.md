# Órulo V2 nacional e CAS legado

A operação é `national-v2-once`. Seu UUID e SHA-256 pertencem ao manifesto consolidado. Fragmentos de transporte, páginas de snapshot e checkpoints não constituem lotes independentes. O escopo pode apenas ser o documento congelado aprovado. Nenhuma instalação, execução de CI ou liberação de Environment emite `WRITE_AUTHORIZED`.

## Compatibilidade e instalação separada

Foram consultadas em produção as assinaturas, corpos, owners e ACLs de treze funções. A captura está em `test-support/orulo-cas/production-contract.json`. A migration `20261111004340_orulo_national_v2_once.sql` confere os SHA-256 dessas definições antes de modificar qualquer objeto. Drift interrompe a instalação inteira. O corpo histórico de `cas_core` permanece intacto. As RPCs públicas e `authorize_pilot` recebem um encaminhamento inicial restrito ao novo modo. `audited_cas_core` continua controlando a intenção previamente confirmada e a gravação transacional do recibo.

A migration cria helpers privados, índices no ledger e uma política RLS adicional para `orulo_audit_owner`. A política aceita exclusivamente a linha anterior ou o resultado exato do INTENT nacional em contexto validado. Ela preserva as políticas históricas e não concede bypass de RLS nem privilégios de API no schema privado. O novo CAS altera somente os arrays `images` autorizados de plantas existentes. Inclusive `updated_at` permanece preservado nesse modo.

A aplicação dessa migration, seu efeito sobre permissões e o merge precisam de autorização de implantação. Esta entrega apenas os versiona. Após instalação aprovada, verificar novamente os owners/ACLs e os índices, `nationalProtocol=1` por chamada server-side autenticada como service_role, ausência de operação anterior aberta e a cadeia do ledger. Não aplicar todas as migrations antigas para recriar um banco já existente.

## Manifesto único

`scripts/orulo-v2-national-manifest.py` usa exclusivamente o manifesto de origem e a reconciliação originais, ambos com hash fixado, e os seis checkpoints autenticados. Reconstrói o manifesto de origem, verifica hashes dos arquivos de evidência e valida os binários completos das URLs. O universo candidato nunca é ampliado por imóveis ou plantas recém-descobertos. Linhas alteradas, imagens já existentes e conflitos ficam fora do documento operacional e são contados separadamente.

A captura de baselines é integral por hash calculado no PostgreSQL. O arquivo final inclui todos os UUIDs, empreendimentos, IDs de plantas, patches, provas de origem, schema, contagens e UUID operacional. O resumo registra seu SHA-256. O conteúdo completo sai do runner somente criptografado para a chave original. A revalidação binária será repetida antes do CAS, com cache de cinco minutos por URL, e qualquer falha interrompe a sessão.

A consolidação em CI é somente leitura no Supabase. Não chama a autorização administrativa nem o executor de escrita. Ela substitui a preparação de cinco registros. Os onze dry runs nacionais anteriores permanecem como histórico.

## Liberação e execução manual

Após revisar CI, manifesto e código e autorizar a implantação, configurar os valores de prontidão revisados, sem alterar credenciais originais.

- `ORULO_NATIONAL_READY=true`.
- `ORULO_NATIONAL_APPROVED_SHA` com o commit completo aprovado na main.
- `ORULO_NATIONAL_MANIFEST_SHA` com o SHA-256 do arquivo nacional aprovado.
- `ORULO_NATIONAL_ARTIFACT_ID` com o artefato criptografado correspondente.
- `ORULO_POSTGRES_AUDIT_READY=true` permanece exigido.

Confirmar os bindings server-side já existentes de `SUPABASE_SECRET_KEY` e `ORULO_V2_PRIVATE_KEY_PEM` no Environment `orulo-lote1`. O Environment deve continuar restrito à main, sem bypass administrativo. A disponibilidade desses bindings no Environment operacional deve ser verificada antes da liberação. A consolidação usa o Environment separado de leitura `orulo-v2-reconciliation`. Nenhum valor secreto aparece nos comandos ou resumos.

O proprietário inicia o workflow manual existente com o commit aprovado.

```bash
gh workflow run orulo-batch-manual.yml --repo mudeisp/ynteligencia --ref main \
  -f batch_id=national-v2-once -f national_action=execute
```

O workflow mantém a concorrência exclusiva compartilhada com os modos históricos, recusa rerun e valida proprietário, branch, commit, Environment e hashes. O documento é registrado em fragmentos e alvos no ledger já existente e depois selado. A autoridade administrativa recebe o UUID operacional, head do selo, SHA do código, GitHub Run ID e contagens. O executor imprime SQL preenchido que chama a função administrativa existente.

```sql
select orulo_audit.authorize_pilot(
  '<UUID operacional>'::uuid,
  '<head SHA-256 do selo>',
  '<GitHub Run ID>',
  '<commit aprovado>',
  'Owner explicitly approves only this complete frozen national-v2-once manifest and exact code revision'
);
```

Os placeholders acima são uma descrição do contrato. O workflow gera o comando real tipado. A função verifica head, documento, commit, sessão administrativa e execução, e emite uma única autorização para todo o manifesto. Um índice único impede autorizar novamente o mesmo hash. A autorização inicial tem lease de cinco horas. Seu escopo permanece imutável nas continuações.

## Processamento, orçamento e interrupções

O job tem teto de seis horas. O executor reserva por padrão quatro horas para processar registros, considerando o baseline, e preserva margem para readback global e término. Não há limite de 500 ou 2.000 registros. As requisições de manifesto usam fragmentos de 128 Ki caracteres; os snapshots usam páginas de 100 UUIDs. Esses tamanhos limitam memória e tráfego sem alterar o universo autorizado.

O fluxo por imóvel é leitura integral, hash contra o documento, validação de origem, INTENT confirmado, CAS sob `FOR UPDATE`, recibo no mesmo commit e readback integral. Todos os patches daquele imóvel são atômicos. Preço, estoque, tipologia, atividade, UF e outros campos permanecem preservados. URLs e imagens presentes bloqueiam a substituição. IDs duplicados bloqueiam a linha inteira.

A lease de cinco horas e o teto de quatro horas de processamento evitam pressupor que toda a operação caiba em um único runner. O tempo real depende de tamanho das linhas, latência do banco e CDN. Confirmar a capacidade efetiva de registro/selo do manifesto antes da autorização. Um timeout no registro não autoriza imóveis. Não aumentar timeouts ou limites de memória automaticamente em produção.

Uma resposta ambígua provoca apenas a recuperação de leitura já implementada. Não há retry automático de CAS. O ledger persiste fora do runner. Se o CAS foi confirmado, a continuação verifica seu `afterSha256`, completa o readback faltante e pula a mutação. INTENT sem resultado impede continuação e exige investigação administrativa do commit/rollback e término da sessão anterior. Não interpretar ausência de resposta como ausência de commit.

Para continuação técnica, iniciar manualmente o mesmo workflow e informar o mesmo UUID.

```bash
gh workflow run orulo-batch-manual.yml --repo mudeisp/ynteligencia --ref main \
  -f batch_id=national-v2-once -f national_action=continue \
  -f national_run_uuid='<UUID operacional original>'
```

O novo runner não grava até o administrador executar o SQL gerado para `orulo_audit.authorize_national_continuation`. Essa função vincula um novo GitHub Run ID ao head atual e ao mesmo documento/código, após confirmação do término do runner anterior. Ela não emite outro `WRITE_AUTHORIZED`, não adiciona alvos e não cria nova operação. Snapshots parciais continuam pelo cursor persistido. Rerun do GitHub continua recusado.

## Concorrência global e reconciliação

`STRICT_GLOBAL_V1` permanece vigente. O baseline/readback usa as tabelas e a captura paginada existentes, com schema, chaves, hashes e selos. O contrato continua sendo uma janela de leitura READ COMMITTED paginada, não uma fotografia MVCC única de horas de duração. Membership/schema/captura incompleta bloqueiam a conclusão.

O servidor distingue `AUTHORIZED_TARGET_CHANGE`, `UNEXPECTED_TARGET_CHANGE`, `EXTERNAL_CHANGE_UNATTRIBUTED` e `EXTERNAL_CHANGE_VERIFIED`. Prova externa não pode ser enviada por service_role como uma flag de confiança. `national_attest_external` é restrita ao administrador e exige UUID fora dos alvos, transição exata dos snapshots, processo, evento independente, transação excluída das transações do executor, hash de prova e justificativa. O administrador precisa autenticar essa evidência independente antes de registrá-la. Sob a política atual, mesmo a classificação externa comprovada continua bloqueando `FINISHED`; ela documenta a reconciliação e não dispensa a regra estrita.

`national_finish` persiste `NATIONAL_RECONCILIATION_REQUIRED` quando houver divergências ou cobertura incompleta. Os CAS confirmados permanecem válidos e não precisam ser repetidos. Falha de captura e INTENT pendente têm códigos próprios e bloqueiam conclusão. Uma linha-alvo divergente nunca recebe uma atualização baseada em novo baseline silencioso.

A reconciliação somente leitura pode ser solicitada com `national_action=reconcile`, inclusive com `ORULO_NATIONAL_READY=false`, mantendo a aprovação do commit e documento. O relatório lê o ledger original; não abre outra operação.

## Critérios de conclusão

- Um UUID, hash e `WRITE_AUTHORIZED` para o documento inteiro.
- Todos os UUIDs-alvo com exatamente um resultado `UPDATED`, recibo e readback coerentes.
- Nenhum INTENT pendente, alvo novo, imagem sobrescrita ou alteração comercial não autorizada.
- Baseline/readback completos e atribuídos por hashes e recibos.
- `FINISHED` somente com `STRICT_GLOBAL_V1` satisfeito. Se a concorrência externa impedir esse resultado, relatar gravações confirmadas e reconciliação pendente separadamente.
- Conferir novamente acessibilidade das imagens e o índice derivado do portal na validação operacional.
- Arquivar o manifesto criptografado e os recibos antes da retenção de 30 dias do artefato GitHub. O ledger permanece durável no PostgreSQL.

Os testes isolados usam as definições dos triggers capturadas em produção e exercitam preservação, rollback conjunto de linha/índice/recibo, continuidade e ausência de retry. Eles não constituem autorização de produção nem evidência de imóveis efetivamente gravados nesta tarefa.
