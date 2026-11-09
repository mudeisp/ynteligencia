# Auditoria do processo anterior

Inspeção do código real de main `673f6f98898e5486cba08892ea49a0727e7aa718` e dos catálogos de funções de produção, sem invocar funções operacionais. O caminho `control/` do pedido é o checkout criado pelo workflow; os arquivos reais estão em `scripts/`.

| Tema | Implementação e conclusão |
|---|---|
| Ausência de imagem | `scripts/orulo-media-recovery-batch.mjs` considera `image_url`, `url`, dimensões e `images`. Arrays não vazios contam como imagem, mesmo sem validação de todos os elementos; separar presença de validade. |
| Origem | `batchSourceClient` autentica por OAuth e usa `orulo-floor-plans.js`, pedindo as três dimensões oficiais. IDs duplicados e planos incompatíveis bloqueiam. |
| Disponibilidade | `verifyBatchImage` restringe host/caminho, recusa redirects e verifica assinatura JPEG/PNG/WEBP por GET parcial. Não prova imagem inteira nem revisão visual. |
| Deduplicação | `batchPatches` consulta uma vez por empreendimento e verifica cada URL uma vez; faz correspondência por ID de planta, preserva imagens existentes e não cria plantas. |
| Manifestos | Catálogo/master e arquivos por lote usam SHA-256 de JSON compacto. Os hashes locais foram revalidados; `phase3-rest` tem três empreendimentos e 29 UUIDs no arquivo histórico. |
| Autorização | Workflow manual restrito a main, proprietário, primeira tentativa e SHA revisado; environment protegido, flags e catálogo por lote. Planejamento espera autorização administrativa privada, vinculada a run/head/SHA/escopo e prazo. Não foi disparado. |
| CAS | RPC atual `orulo_audited_cas` exige serviço autorizado, INTENT durável, autorização do lote, baseline recente e associação de UUID ao alvo. `audited_cas_core` conserva comparação integral, transação curta, verificação de preservação e recibo. |
| Bloqueio legado | `public.orulo_media_cas` está substituída por função que lança `AUDITED_CAS_REQUIRED`. Não foi chamada. |
| Ledger | SHA-256 do canônico e encadeamento por execução; eventos imutáveis, bloqueio consultivo, sem reaproveitar operação. Timeout não autoriza retry. Foram verificados hashes/cadeia/divergência evento-canônico e intents sem resultado. |
| Antes/depois | Snapshots V2 paginados por PK, metadados de conjunto e colunas, hashes de conteúdo/preservação e recibos. Capturá-los escreve no ledger; nenhuma captura remota nova foi iniciada. |
| Rollback | Testes locais cobrem rollback transacional em falhas. Reversão de dados em produção exige outro CAS com pós-estado esperado e mídia anterior do ledger; nunca restaurar raw_data inteiro. |

As funções de produção foram lidas e suas definições e ACLs preservadas em `audit/inputs/functions.json`, com hashes em `audit/function-catalog.json`. `orulo_audit.batch_catalog` contém liberações históricas inclusive phase3 e pilotos; elas não autorizam o novo lote nacional. Não foram modificadas flags, grants, funções, triggers, migrations nem workflows.

`scripts/orulo-national-dry-run.mjs` é diagnóstico anterior, restrito a grupos V4 pequenos, imóveis ativos e estados dos lotes. Ele associa URLs a IDs, mas não verifica os bytes CDN e não implementa o novo inventário de todos os imóveis. Não foi tratado como executor nacional pronto.

O endpoint `api/development.js` é uma alternativa pública de leitura e foi usado historicamente. A inspeção encontrou fallback silencioso para plantas do banco e rótulo de origem calculado apenas pela presença de plantas no resultado. Por isso suas respostas amostradas não foram promovidas para `RECOVERABLE`. Esta preparação documenta a vulnerabilidade e não altera o comportamento de produção.
