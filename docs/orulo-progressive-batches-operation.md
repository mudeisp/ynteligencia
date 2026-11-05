# Autorização progressiva Órulo SP

## Estado desta entrega

Preparação para revisão. Não executar agora. Não houve instalação da migração, WRITE_AUTHORIZED, mudança de variáveis, dispatch operacional, backfill ou alteração de imóvel em produção. O piloto 43126 continua compatível e fora dos novos lotes. O manifesto original de 99 IDs não foi alterado; 86644 permanece excluído.

O executor reutiliza o journal PostgreSQL privado existente, a captura paginada V2, a chave estável UUID, SHA-256 do ledger e a comparação integral da linha por CAS. Não há tabela paralela de auditoria nem endpoint público. A única RPC que altera imóveis é `public.orulo_audited_cas`. A função administrativa continua sendo `orulo_audit.authorize_pilot(uuid,text,text,text,text)`, restrita ao proprietário autenticado no SQL Editor. Nenhum privilégio administrativo é concedido aos papéis API.

## Primeiro lote, somente após aprovação futura

1. Revisar o PR, CI, manifestos e relatório dos 83 empreendimentos. Fazer merge apenas mediante autorização do proprietário.
2. Com autorização específica de implantação, revisar/aplicar `20261104151850_orulo_manifest_batches.sql`. Confirmar `health.batchProtocol=1` e o master hash igual ao catalog. Conferir ACL, ausência de execução aberta/operação incerta e Environment privado `orulo-lote1`, permitido apenas main, sem bypass administrativo. A migração não modifica imóveis ou autoriza execução.
3. Revisar o commit exato da main que contém o controle. Somente então o proprietário configura `ORULO_BATCH_APPROVED_SHA` com esse SHA completo e `ORULO_BATCH_READY=true`; a prontidão PostgreSQL existente continua exigida. Não alterar as credenciais existentes.
4. Abrir previamente o [SQL Editor autenticado](https://supabase.com/dashboard/project/wzaegidwtdjuhqchpdpd/sql/new). O proprietário `mudeisp` inicia uma execução nova, manual, em main, de [orulo-batch-manual.yml](https://github.com/mudeisp/ynteligencia/actions/workflows/orulo-batch-manual.yml), escolhendo **phase1-20**. Não usar rerun. Concorrência compartilhada com o piloto e demais operações: uma execução por vez.
5. O executor consulta somente os UUIDs do manifesto, refaz Órulo e a verificação das URLs. No início da apresentação do BATCH_PLAN, os logs ao vivo mostram um resumo compacto: Run UUID, GitHub Run ID, Head Hash, commit, quantidade de imóveis, empreendimentos/IDs, ocorrências de plantas, URLs distintas e status pendente. O SQL administrativo preenchido aparece logo depois, entre marcadores próprios, sem JSON extenso entre o resumo e o comando. O plano completo, com todos os UUIDs e patches/URLs, permanece no ledger encadeado; o grupo recolhido "Consultar plano completo no ledger" fornece um SELECT somente leitura vinculado ao Run UUID e ao Head Hash. Conferir o escopo e a correspondência das plantas no plano completo antes de confirmar.
6. Só após confirmação explícita do plano exato, copiar o bloco preenchido para o SQL Editor e executar uma vez. Ele chama a função administrativa existente e recusa plano expirado, alterado ou encerrado. A espera do executor é de 10 minutos; autorização de 30 minutos, exclusiva daquela execução/plano. Não é possível preencher um comando real antecipadamente: ainda não existe nova execução/plano autorizado nesta preparação.
7. Aguardar baseline fresco e CAS por UUID, com INTENT previamente confirmado e CAS_RESULT transacional. Conferir readback e relatório final. Não iniciar o próximo lote antes de revisar/aceitar o resultado. Desabilitar novamente a prontidão após a execução.

O mesmo resumo e o SQL em bloco separado são escritos no GitHub Actions Job Summary. O GitHub pode exibir esse Summary apenas quando a etapa terminar; durante a janela ativa, usar os logs ao vivo. O status apresentado é o da geração do plano, não uma autorização nem garantia de que o run ainda está ativo. As verificações existentes continuam rejeitando plano expirado, encerrado ou alterado. A janela de espera e a validade do plano continuam em dez minutos; a apresentação não prorroga esse prazo.

A apresentação inclui somente metadados tipados permitidos. Campos extras, tokens, credenciais, corpos JSON, UUIDs/patches extensos e URLs de imagens não são despejados no log principal ou no Summary. O plano completo continua privado no ledger, com seu hash original; não há novo artefato público, endpoint, permissão ou mecanismo de autorização.

## Limites de escopo e parada

O master e cada manifesto possuem SHA-256 próprio. O catálogo servidor fixa buildings, UUIDs e IDs de plantas ausentes. A autorização é vinculada ao head do BATCH_PLAN, commit, hash do manifesto, UUIDs e patches exatos. Mudança de escopo exige novo PR/manifesto; sucesso não concede autorização futura. As fases 2 e 3 estão explicitamente bloqueadas no cliente e servidor (`released=false`); promovê-las exige revisão separada após aprovação do relatório anterior. Não alterar essas flags para liberar todas as fases.

Somente chaves de imagem de plantas existentes e sem imagem podem ser preenchidas. IDs, ordem, descrição e campos comerciais são preservados. A função valida o patch contra o plano autorizado; CAS compara toda a linha sob bloqueio e altera apenas `raw_data.building.floor_plans` e `updated_at`, com comprovante na mesma transação. Baseline deve ser posterior à autorização e ter menos de cinco minutos; se exceder esse prazo, a operação para.

Conflito, falha de cadeia, mudança de schema/membership, RPC/timeout ou readback divergente interrompe. Em resposta ambígua ocorre apenas leitura de recuperação; nunca nova tentativa automática. A ausência de autorização não chama CAS e gera STOP durável. Se a resposta do próprio journal for incerta, ele fica congelado e exige reconciliação administrativa pelo ledger, sem inventar um STOP confirmado.

Para estes lotes operacionais, a política global é conservadora: toda divergência não atribuída exatamente a comprovante CAS confiável impede FINISHED, inclusive fora do manifesto. As atualizações normais do inventário continuam permitidas; são registradas como concorrentes e precisam ser explicadas administrativamente. Não se presume que uma alteração externa foi causada pelo backfill. A pré-flight somente leitura existente mantém sua política de ressalvas externas.

## Falha, reconciliação e rollback

Desativar `ORULO_BATCH_READY` impede novas operações. Não reenviar CAS incerto, não usar rerun e não reabrir Run UUID. Confirmar término GitHub; verificar cadeia, INTENT/CAS_RESULT, recibos e os UUIDs com readback antes de classificar a falha. Acrescentar ABORTED exclusivamente após reconciliar todos os resultados; nunca apagar eventos ou editar evidência. Um lote novo exige execução e autorização novas, exclui imagens já presentes e bloqueia drift.

Rollback de código/configuração: desativar prontidão e reverter o controle via PR revisado. Não apagar ledger, snapshots, funções ou recibos. Não remover imagens em massa para “desfazer”: qualquer correção de imóvel exige autorização específica e novo CAS com estado atual. Os wrappers anteriores foram preservados privadamente para compatibilidade, mas não oferecem bypass público. Não conceder EXECUTE/USAGE no schema privado a service_role, anon ou authenticated.

## Testes

`npm ci --prefix test-support/orulo-cas --ignore-scripts --no-audit --no-fund` e `npm test --prefix test-support/orulo-cas` executam regressão isolada. O CI `Orulo CAS concurrency` também executa PostgreSQL 17.6 descartável, WAL durável e sessões concorrentes reais. Os fixtures têm UUIDs/IDs do manifesto e dados comerciais sintéticos, sem credenciais de produção. Nunca direcionar testes ao Supabase.
