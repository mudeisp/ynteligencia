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

## Escopo desta fundação

Este PR é **apenas documentação operacional e contrato seguro de implementação**. Não há migração, alteração da API, CAS, executor, SQL de autorização, execução em produção, merge ou deploy. Ele **não declara o V9 concluído** e não remove o bloqueio de concorrência; é uma análise rastreável para evitar uma implementação insegura.
