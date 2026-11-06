# V8 — diagnóstico conservador de concorrência global

## Defeito e limite de atribuição

`classifyCaptures` classifica o universo histórico por building ID, mas isso não
atribui autoria. Em `executeBatch`, todo delta sem recibo do próprio executor gera
`BATCH_UNATTRIBUTED_GLOBAL_CHANGE`. No piloto 5971 o journal reconheceu o CAS correto,
mas cinco outros UUIDs permaneceram sem atribuição. O alvo 5971 aparece como
OUT_OF_SCOPE no classificador histórico porque não pertence ao manifesto original
de 99 buildings; o recibo correto já era reconhecido pelo executor.

Evidência preservada, sem reabrir o run `dbc2b806-3c1f-4c61-b4cd-d1f65d882900`:
CLIENT_READBACK/BATCH_INTEGRITY, sequência 885. Quatro mudanças de conteúdo e uma
apenas de updated_at ocorreram nos UUIDs abaixo. Os hashes antes/depois estão no
evento original. As versões atuais conferiram com os hashes depois na leitura V8.

| UUID | Building | Tipo | xmin observado |
| --- | --- | --- | --- |
| 33f9afe8-5996-4905-a56e-380b31066eaa | 64516 | timestampOnly | 89090 |
| 47cc462c-6da8-4e78-8dbc-771b6c65bd1c | 64516 | contentChanges | 89088 |
| 8941e492-f109-44ca-9a4f-0fbbb791ab73 | 64515 | contentChanges | 89064 |
| 992ffb0b-cf5f-4e2e-8ce4-c432fdf16c44 | 64516 | contentChanges | 89088 |
| 9c6a9a42-b3cf-4cf1-a705-4131ac05a9fe | 64516 | contentChanges | 89088 |

O CAS do piloto foi registrado na sequência 444, transação 89251, às
10:44:57 UTC. As cinco versões têm timestamps 10:43:51–10:43:57 UTC. São evidências
de transações distintas, não uma identidade autenticada do processo externo.
Os logs Supabase mostram leituras dos dois buildings e um PATCH correlacionado.
Os logs Vercel do projeto que atende app.yincorp.com.br corroboram a execução
de POST /api/orulo-webhook: para 64516, request
`p2zxr-1793961836720-d8206bf81bb6`, houve três upserts e uma desativação; para
64515, request `svf4r-1793961830650-c08bbbea217f`, houve dois upserts. Essa
corroboração identifica o processo, mas não fornece um recibo transacional
autenticado de cada UUID com hashes antes/depois e campos alterados. O executor
não tem um leitor confiável dessa prova por transição. User-agent `node`, horário,
contagens agregadas ou UUID fora do lote não bastam para liberação automática.

Os snapshots existentes guardam hashes da linha/conteúdo, não valores ou hashes
por campo. Assim, apenas `updated_at` é identificável no caso timestampOnly.
Os campos exatos dos quatro deltas de conteúdo não podem ser reconstruídos com
essas evidências. O caso histórico de 86716/68278 sofre da mesma regra estrita;
nenhum recibo, encerramento administrativo ou evento anterior foi modificado.

## Mudança mínima e política vigente

O classificador V8 acrescenta cinco categorias determinísticas. Um alvo exige
recibo UPDATED/verified, correspondência de todos os hashes e readback. Mudança
inesperada no alvo, recibo ausente/divergente ou captura incompleta bloqueia.
Os caminhos alterados no alvo são calculados a partir do antes/depois já lido.
Os deltas externos mantêm UUID, tipo e hashes; campos não recuperáveis ficam null.

`EXTERNAL_CHANGE_VERIFIED` tem um contrato de atestação independente testado com
fixtures. Não existe leitor autenticado de origem configurado no executor, nem
input/flag para fornecer essa atestação. Um JSON alegando `verified=true` não é
aceito. Na execução real atual, os externos permanecem
`EXTERNAL_CHANGE_UNATTRIBUTED`. Mesmo uma fixture atestada não autoriza FINISHED:
a política SQL `STRICT_GLOBAL_V1` permanece bloqueante para qualquer delta externo.

O campo novo `attributionV8` é anexado ao CLIENT_READBACK existente, mantendo
`review`, `unexplained` e seus significados. Apenas captura ilegível usa a etapa
diagnóstica BATCH_INTEGRITY_V8. O evento continua na mesma cadeia SHA256; não há
novo ledger, tabela, SQL ou migration. Nenhum delta completo é descartado.

Para permitir futuramente concorrência externa, é necessário primeiro obter uma
atestação confiável de ator/transação/transição exata e revisar sua validação no
servidor. Esta entrega implementa o diagnóstico e mantém o bloqueio, conforme
a instrução de segurança; não usa correlação temporal como autorização.

## Cinco propostas, sem autorização SQL

Selecionadas pelo menor número de ocorrências entre os sete candidatos restantes,
com sete UUIDs ativos, preço/metragem válidos e sem INTENT/CAS_RESULT anterior.
Foram feitas cinco consultas ao proxy existente e 29 verificações de assinatura
de imagem. A identidade building/UF/plan ID e as URLs coincidiram com a evidência V5.
O proxy pode fazer fallback; uma escrita futura exige conferência direta da fonte.

| Building | Plantas | Ocorrências | SHA256 do JSON |
| --- | ---: | ---: | --- |
| 9669 | 2 | 4 | 32c532289d5b5132e65cd59253d9c0cba686f0f8ba8230fff82f9635b0ea8cec |
| 7475 | 5 | 5 | 1eb61ecf803bbb4f6b6e827c835c86d496d71ea6c2f8ed9c7ba26a01ff8f5d7c |
| 5375 | 4 | 8 | 0362ca98c9387685e82e19845cf42f83b352f29d24d20bfc5607471c920eead8 |
| 9756 | 8 | 8 | 32b0424e1c915b7a8ff024957259ec5e7bbbc9f7ade27381dc9f1eed4111ed4e |
| 6784 | 10 | 10 | 16cded36a5101bcbab2caa8e5231665d934fa4c8b1b1377438c7f2d13c43d161 |

Os JSONs em `docs/orulo-v8-preparation/` contêm UUIDs, planos, URLs, estado atual,
hashes e critérios de bloqueio. São propostas revisáveis, não inputs operacionais.
Não foram acrescentados ao catálogo SQL nem aos 257 lotes nacionais.

## Infini Vila Mariana

Página canônica: https://www.yincorp.com.br/sp/sao-paulo/empreendimento/infini-vila-mariana--orulo-5971

Supabase: os dois image_url estão presentes. API existente: duas URLs disponíveis,
HTTP 200. HTML público: HTTP 200, canonical correto e dois desenhos renderizados.
O navegador abriu ambas as plantas: 251614.JPG (841x411) e 251615.JPG (562x578).
`portal/inventory.js` projeta raw_data.building.floor_plans e `portal/details.js`
prioriza image_url. Não é necessária alteração visual ou de frontend.
