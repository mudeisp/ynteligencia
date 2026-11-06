# Órulo V9 — proveniência transacional (fundação, sem liberação de escrita)

## Evidência que motiva a mudança

O webhook em `lib/orulo-webhook-core.js` executa operações independentes via PostgREST:
`POST /rest/v1/properties?on_conflict=external_id` para upserts e `PATCH` para desativações.
As respostas `return=representation` não contêm recibo assinado/transacional com hashes de antes/depois.
`getExistingBuildingRows` busca apenas `external_id,active,raw_data`, não fornece snapshot completo.
No V8, cinco UUIDs dos buildings 64515/64516 mudaram fora do lote autorizado. Horário, request ID e logs corroboram webhooks, mas **não provam** a autoria de cada transição.

## Contrato de segurança V9

Um registro só pode passar a `EXTERNAL_CHANGE_VERIFIED` quando **todas** as condições forem verdadeiras:

1. A evidência é gerada **dentro da mesma transação PostgreSQL que modifica a linha**, não após resposta HTTP ou por logs.
2. Inclui `uuid`, operação, `txid`, hash completo antes/depois no mesmo algoritmo dos snapshots, caminhos alterados, ID de evento, e origem vinculada de modo autenticado.
3. O leitor de atestações tem acesso controlado e busca a transição por UUID **e ambos os hashes** observados em BASELINE_V2/READBACK_V2. Não aceita JSON do cliente como prova.
4. Há distinção explícita entre **observação transacional** e **identidade autenticada do escritor**. `current_user=service_role`, request ID, `application_name`, JWT enviado pelo próprio escritor ou `set_config` não bastam para identificar o webhook, pois podem ser compartilhados/forjados.
5. Se ocorrerem duas ou mais transições do mesmo UUID entre snapshots, todas devem compor uma cadeia contínua que explique exatamente o estado inicial e o final; não escolher apenas o último recibo.
6. A atestação jamais autoriza alterações de alvos do CAS, dados comerciais, drift de schema, snapshots incompletos, recibo ausente ou escrita incerta.
7. Sem comprovante de autoria por transição, resultado continua `EXTERNAL_CHANGE_UNATTRIBUTED` e `STRICT_GLOBAL_V1` continua bloqueando `FINISHED`.

## Implementação necessária para o V9 completo

- Criar um caminho **restrito e autenticado** para escrita do webhook, isolado de outras rotas que usam a mesma service key. Autenticar a identidade do escritor **no servidor PostgreSQL** e registrar o mesmo ator/txid e transição na mesma transação. Preferir um papel PostgreSQL de privilégio mínimo ou credencial dedicada a operação específica, com ACL explícitas.
- Capturar BEFORE/AFTER por UUID com hashes exatamente iguais ao algoritmo dos snapshots; documentar normalização de `created_at` e `updated_at`.
- Capturar mudanças em `raw_data` por caminho, sem confundir atualização redundante de `updated_at` com alteração comercial.
- Distinguir insert, update e delete; lidar com upserts e desativações. Não tornar o armazenamento de proveniência acessível via Data API pública; negar `anon`/`authenticated`/`service_role` onde aplicável e evitar `SECURITY DEFINER` em `public`.
- Estabelecer retenção, particionamento/limpeza auditável e controle de volume antes de instalar triggers em `public.properties`.
- Validar concorrência real com duas transações e **uma tentativa deliberada de spoofing** por rota que compartilha a antiga service key.
- **Não ativar** a ramificação de `FINISHED` tolerante a concorrência enquanto a política SQL do servidor continuar `STRICT_GLOBAL_V1` ou enquanto a prova não puder ser conferida ponta a ponta.

## Inventário de operações existentes

- `getExistingBuildingRows`: GET de linhas do building.
- `upsertBuildingRows`: POST upsert conjunto; pode atualizar múltiplos UUIDs na mesma solicitação HTTP.
- `deactivateStaleRows`: PATCH por `external_id`, operações separadas.
- `softDeleteBuilding`: PATCH por building, pode alterar vários UUIDs.
- `normalizeBuilding`: escreve `updated_at` a cada evento, mesmo em conteúdo estável.
- Também existe `lib/orulo-sync-core.js`, caminho de atualização distinto que deve permanecer **não atestado como webhook** até possuir identidade própria.

## Sequência de rollout

1. Desenvolver e testar, isoladamente, a estrutura de recibos e ACL; nenhum DDL remoto no PR de fundação.
2. Criar a rota autenticada e transacional, com testes PostgreSQL nativos e sem alterar payload/semântica comercial.
3. Validar em preview/base isolada; confirmar retornos `id`/hash, duplicidade, falhas e rollback atômico.
4. Publicar código e migração em etapas, monitorando custo e latência; manter o classificador bloqueante.
5. Somente com evidências completas e revisão separada alterar a política do servidor para tolerar **apenas** concorrência externa comprovada.
6. Revalidar os cinco manifestos (9669/7475/5375/9756/6784); novo hash/proposta e autorização administrativa individuais para qualquer escrita futura.

## Implementação V9 preparada, sem ativação

Este PR agora implementa a fundação transacional abaixo. Não instala SQL remoto, não provisiona credenciais, não altera o entrypoint de produção nem libera concorrência externa. `STRICT_GLOBAL_V1` permanece bloqueante, inclusive para prova positiva. Não há alteração dos 257 lotes, autorizações, recibos ou eventos históricos.

### Migration e identidade

`supabase/migrations/20261106114525_orulo_webhook_provenance.sql` foi criada com `supabase migration new` (CLI 3.0.0). Depende do journal PostgreSQL e dos snapshots paginados V2 já existentes. Usa o schema privado `orulo_audit`, seu proprietário e seu mecanismo append-only; `property_transitions` é uma coleção tipada de recibos de linha, não outro ledger de aprovação ou cadeia administrativa. Nenhum evento antigo muda de significado ou hash.

São criados `orulo_webhook_writer` e `orulo_provenance_reader`, ambos **NOLOGIN**, sem privilégios administrativos, bypass de RLS, memberships ou DML direto. A identidade não é um JWT, uma flag, `application_name`, `current_user` ou a service key. As funções exigem `session_user` igual ao login dedicado correspondente. Mesmo um encaminhador SECURITY DEFINER chamado pela identidade antiga não passa nessa verificação. `SET ROLE` não altera `session_user`; a identidade antiga não recebe membership nos novos papéis. Administradores do banco continuam sendo a raiz de confiança.

O papel proprietário privado `orulo_webhook_owner` é NOLOGIN/NOBYPASSRLS. Apenas sua função de aplicação tem SELECT/INSERT/UPDATE em imóveis Órulo `source=novos`, por políticas RLS. O escritor só executa `orulo_audit.apply_webhook`; não recebe SELECT/DML de tabelas, DELETE, auditoria administrativa ou CAS. `anon`, `authenticated` e `service_role` não acessam as funções novas nem a tabela de recibos. Nenhuma função SECURITY DEFINER é criada em `public`.

### Atomicidade e semântica comercial

`apply_webhook(building, rows, removed, updated_at)` aplica o payload do normalizador existente: mesmos campos, preço, estoque, mídia e external IDs; preserva `id` e `created_at` no conflito. Inclui as desativações de linhas antigas e a remoção lógica no mesmo comando/transação. `excluded_from_distribution`, filtro residencial e ausência de tipologias continuam no handler atual. Nenhum valor de preço/estoque é inventado ou recomposto pelo novo caminho.

Um advisory lock por building serializa os novos escritores; os locks de linha do PostgreSQL continuam protegendo conflitos com CAS/escritores antigos. O trigger AFTER INSERT/UPDATE/DELETE observa cada transição de imóveis `external_id=orulo:*`, inclusive caminhos antigos e CAS, sem atestá-los como webhook. Registra UUID, operação, xid8 do servidor, sessão autenticada, hashes completos/de conteúdo, caminhos JSON Pointer, UUID de evento, horário e SHA256 do envelope canônico. Não registra valores anteriores/posteriores completos nem credenciais. `created_at`/`updated_at` são normalizados para UTC exatamente como BASELINE_V2/READBACK_V2; MD5 dos JSONB canônicos segue o algoritmo existente, e o hash de conteúdo exclui apenas `updated_at`.

Falha no recibo desfaz a alteração e os recibos anteriores da mesma operação. Falha posterior no comando também desfaz tudo. Falha de resposta/COMMIT é incerta: o adapter não repete nem faz fallback REST. Sem no-op administrativo, autorização ou retry de recuperação.

### Integração preparada e leitor

`lib/orulo-webhook-provenance.js` recebe uma conexão PostgreSQL server-side com query parametrizada. `createWebhookHandler({writer})` em `lib/orulo-webhook-core.js` aceita esse adapter explicitamente; **o export default e os wrappers com hidratação de plantas continuam no caminho existente**. Não existe flag de payload/env para ativação, conexão implícita, novo driver em produção ou fallback após erro do adapter. O cliente dedicado e seu lifecycle/TLS deverão ser integrados e revisados separadamente; não há credencial compartilhada que possa ser usada como substituição.

`read_webhook_provenance(run, uuid)` exige o login leitor separado e deriva hashes/time bounds das páginas seladas do journal. Não aceita endpoints ou atestações fornecidos pelo cliente. Exige ambos os snapshots selados/estáveis, mesmo schema, UUID presente em ambos, ausência de INTENT para o alvo e todas as transições ordenadas dentro da janela. Revalida o SHA256 e todos os campos do envelope. Cada elo deve ligar os hashes completos e de conteúdo; qualquer escritor não autenticado, gap, excesso de 100 transições, recibo inválido ou transação também usada pelo executor invalida a prova inteira. Não escolhe só o último recibo. Inserção/deleção são observadas, mas drift de membership continua sem atestação tolerante.

`scripts/orulo-webhook-provenance-reader.mjs` prepara o leitor controlado. O executor batch aceita essa dependência por injeção interna; nenhum workflow o configura. Erro do leitor fica `FAILED_CLOSED`, mudanças continuam registradas e bloqueantes. A função V8 pode produzir `EXTERNAL_CHANGE_VERIFIED` diagnóstico, mas isso **não permite FINISHED**. O SQL de autorização/finish não é alterado. A classificação de scope histórica é preservada; mudanças que não satisfazem o scope conservador V8 continuam sem prova aceita.

### Testes isolados e limitações de ativação

Os testes nativos usam exclusivamente `127.0.0.1` e `orulo_v9_test`; criam/recriam somente essa base sintética. Logins com trust são fixtures locais, não uma configuração sugerida para produção. Cobrem ACLs/NOLOGIN inicial, spoofing de role/GUC/JWT/application_name, encaminhador privilegiado, hashes UTC, caminhos aninhados, INSERT/UPDATE/DELETE, rollback de múltiplas linhas, leitura por cadeia completa, elo intermediário não atribuído, concorrência real de duas sessões, rollback de transação, CAS bloqueado por alteração concorrente e integridade de seus recibos. Testes dos adapters verificam payload/mídias, parâmetros e ausência de retry/fallback.

A CI existente `orulo-cas.yml` inclui esses testes sem secrets, usando PostgreSQL 17.6 descartável; nenhuma execução de recuperação é criada. Os testes antigos de coordenadas passam a ler/importar os módulos core atuais, em vez dos wrappers que já não exportam o normalizador.

**Bloqueios antes de qualquer instalação/ativação:**

1. Revisar migration, memberships e ACLs na versão real do PostgreSQL, além da compatibilidade de schema/defaults/índice unique `external_id` e RLS existentes. A migration rejeita colisão de nomes dos novos papéis em vez de reutilizar identidade desconhecida.
2. Medir volume e latência em staging. Há um recibo por linha/transição, com hashes e caminhos de raw_data; a recursão pode custar CPU. Não há purga automática: preservar durante a janela de auditoria/reconciliação, definir capacidade/retention/archive/particionamento auditável em revisão separada antes de instalar o trigger. Não remover recibos necessários para snapshots ativos ou históricos. Não instalar sem esse dimensionamento.
3. Provisionar, por autorização separada, credenciais SCRAM exclusivas e TLS validado para escritor/leitor. Os papéis permanecem NOLOGIN nesta migration. Exigir conexão que autentique realmente esse papel como `session_user`; não usar PostgREST/authenticator compartilhado ou pool que descaracterize a identidade. Não colocar essas credenciais em cliente público, outros jobs ou sync.
4. Conectar o adapter a um driver/pool revisado, preservar `withOruloFloorPlans`, verificar `session_user` ponta a ponta, observar id/hash e rollback em staging. O driver não foi adicionado nem o caminho de produção ativado neste PR.
5. O trigger não prova autenticidade do remetente HTTP Órulo: prova a identidade do processo DB exclusivo. Verificação do acesso ao endpoint e proteção da credencial desse processo precisam fazer parte da revisão de ativação. Uma credencial dedicada comprometida continua sendo risco; não tratar sua posse como autorização de recuperação.
6. As janelas são conservadoras: alteração iniciada antes de registrar uma página mas confirmada depois pode não ser atribuível; isso gera bloqueio, não aprovação. Histórico anterior à instalação não ganha proveniência retroativa. Mais de 100 transições/UUID ou schema/membership drift bloqueiam diagnóstico positivo.
7. Manter `STRICT_GLOBAL_V1` e os controles de CAS existentes. Somente outra revisão completa poderá mudar a política de finish no servidor. O presente PR não fornece nem consome autorização de mídia, não libera os cinco candidatos V8 e não reabre históricos.

## Validação intensiva — 2026-11-06

O HEAD inicial desta rodada foi `597c7707bba266374a3ada92d21280bc2d510a74`. A CI `42217087829` já estava aprovada nos três jobs, inclusive SCRAM. O erro de quoting/inspeção de `pg_hba_file_rules` do desenvolvimento anterior estava corrigido; não foi repetido nem contornado. Nenhum AGENTS.md foi encontrado no repositório ou nos diretórios ancestrais de trabalho inspecionados.

O script com nome histórico `orulo-v9-scram-staging-smoke.sh` cria somente um contêiner CI descartável. Ele **não é staging**. O nome do job e seu marcador terminal agora explicitam essa distinção. Não há entrada que aceite host/DSN remoto.

### Provas adicionais e regressões

- SCRAM real em TCP: HBA exige `scram-sha-256`, verificadores são inspecionados apenas como booleanos/contagem (nunca impressos), e senha incorreta é recusada.
- TLS real: CA e certificado sintéticos temporários, `sslmode=verify-full`, verificação de `pg_stat_ssl`, rejeição de CA errada, hostname errado e conexão sem criptografia. Usa libpq/psql e servidor PostgreSQL reais, sem mock de autenticação. Segue [libpq SSL](https://www.postgresql.org/docs/17/libpq-ssl.html) e [password authentication](https://www.postgresql.org/docs/17/auth-password.html).
- Reconexões reais confirmam sessões diferentes e ausência de estado herdado. Isso **não valida um pool**: nenhum driver/pool operacional está integrado. Reuso/reset, descarte de conexão quebrada, limites, COMMIT e comportamento de pooler continuam requisitos de staging.
- A função é exercitada pelo escritor autenticado em TLS: aplicação, repetição idêntica sem novo efeito, rollback integral e COMMIT seguido de perda de conexão. A última condição é reconciliada por leitura, sem repetir a escrita.
- Três testes novos falharam contra a implementação original: `UNKNOWN` com arrays era aceito pelo adapter; IDs internos conflitantes eram aceitos; payloads repetidos geravam novos timestamps/recibos. As correções são restritas ao caminho V9 não ativado.
- A resposta SQL agora inclui protocolo/status, building, tipo da operação e xid. O adapter exige `ORULO_WEBHOOK_TRANSACTION_V1`/`APPLIED` e escopo compatível. Resposta incompleta, ambígua ou `UNKNOWN` falha sem retry/fallback.
- SQL rejeita conflito explícito entre `raw_data.building.id`, `building_id`, IDs de tipologia e `external_id`. Isso prova consistência de identidade, **não a correção visual de cada imagem nem a autenticidade da resposta HTTP da fonte**.
- Payload normalizado idêntico, excluindo apenas `updated_at`, não altera a linha nem gera novo recibo. Linhas já inativas não são regravadas nas desativações. A representação e os contadores de linhas selecionadas permanecem disponíveis. Não há ledger/event ID novo; isso não promete deduplicação global de eventos diferentes ou ordenação de notificações atrasadas.
- O no-op mantém locks de linha até COMMIT, inclusive em imóveis já inativos. Uma regressão adicional demonstrou que apenas pular o UPDATE liberava uma reativação legada antes do COMMIT; a leitura ordenada com FOR UPDATE preserva a exclusão entre escritores sem produzir recibo redundante. Deadlock/lock timeout permanece erro com rollback, não motivo para retry.
- Os testes de integridade recusam hash de recibo inválido e inconsistência entre campos e envelope, mesmo quando o hash do envelope em si permanece coerente. Fixtures administrativas corrompidas são rollback-only e locais; nenhuma evidência histórica remota foi alterada.

### Descoberta de staging e procedimento pendente

As consultas somente leitura disponíveis listaram os projetos `yinteligencia` (`wzaegidwtdjuhqchpdpd`, produção conhecida) e `agente.yincorp` (`bgggafirdjvxihqselha`, outro sistema), além de **zero branches** de desenvolvimento no projeto de inventário. Não foi encontrada identificação/autorização de uma base staging isolada no repositório. Nomes de projetos ou um Preview Vercel não demonstram isolamento de dados. Não foram consultados valores de secrets, criados serviços ou executados DDL/DML remoto.

Estado máximo possível nesta rodada: **CI_VALIDATED**, com **STAGING_BLOCKED** enquanto faltar ambiente identificado e autorizado. Não declarar `STAGING_VALIDATED` com base no contêiner ou nos testes locais.

Para a próxima execução autorizada, em ordem:

1. Registrar project/ref, host, database, proprietário, região e autorização de staging; provar recursos/credenciais/filas/webhooks/storage independentes de produção e bloquear os dois refs acima como destinos de ensaio. Se houver compartilhamento ou dúvida, não escrever.
2. Com acesso administrativo exclusivo de staging, inspecionar versão, schema, defaults/unique `external_id`, RLS/ACL e nomes/memberships dos papéis; confirmar ausência de dados reais e de consumidores/webhooks comerciais. Fazer o preflight antes de aplicar qualquer migration.
3. Aplicar a migration versionada revisada somente nessa base; instalar credenciais exclusivas SCRAM/TLS por procedimento seguro, sem copiá-las de produção. Confirmar `session_user`, HBA/SSL, verificadores sem imprimir conteúdo e os testes negativos de senha/CA/hostname/ACL.
4. Integrar e ensaiar o driver/pool candidato com autocommit confirmado, reset de sessão, timeout e descarte de conexões quebradas. Um resultado de função dentro de uma transação aberta **não é prova de COMMIT**. Preservar a hidratação existente de plantas e não adicionar retry de mutação após perda de resposta.
5. Reutilizar os cenários automatizados do PR com UUIDs/external IDs sintéticos: duplicidade, identidade conflitante, cadeia, concorrência, rollback, perda de conexão após COMMIT e readback. Não retirar os guards locais dos testes destrutivos para apontá-los para staging; adaptar o harness por revisão específica ao ambiente identificado.
6. Exercitar o webhook HTTP controlado sem distribuição real, demonstrar autenticação do remetente, payload/response da fonte e vínculo entre planta e mídia. Medir latência p95, volume por transição, retenção e recuperação operacional. Não inferir essas provas a partir de logs de CI.
7. Anexar evidências do HEAD efetivamente executado, ambiente, CA/hostname verificados, fixtures, resultados e zero acesso à produção. Somente então avaliar `STAGING_VALIDATED`. `STRICT_GLOBAL_V1`, autorizações de recuperação e produção continuam fora dessa liberação.
