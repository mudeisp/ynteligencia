# phase1-20 — preparação de 122 imagens ausentes

**Resultado: APTO para solicitar a autorização de uma futura recuperação controlada. Nenhuma escrita está autorizada por este relatório.**

Código operacional revisado: [PR #90](https://github.com/mudeisp/ynteligencia/pull/90), main `7e7d8a3cb32ffbce9820c1197fb298f75ca3ba71`. Este PR de preparação acrescenta evidências e teste; não modifica executor, gate, workflow, manifesto, migrações, permissões ou variáveis de produção.

## Três alterações anteriores auditadas

| UUID | Building | Plantas que receberam imagens | Atualização do registro, São Paulo |
|---|---|---|---|
| 507a0489-1be8-4853-81a5-e7bd079cdb2b | 27977 | 928221, 928222, 928223 | 04/11/2026 14:40:28.831 |
| 7d839f0c-f0b3-495b-bed4-bc33a4b4beca | 63635 | 2017637 a 2017641 | 04/11/2026 15:01:28.672 |
| e582fe78-6167-4ed4-942f-9b5a63a73c5e | 63635 | 2017637 a 2017641 | 04/11/2026 15:01:28.672 |

São 13 ocorrências preenchidas, oito plantas únicas e 24 URLs distintas, contando as três dimensões. O [arquivo de auditoria](orulo-phase1-three-updates-audit.json) registra, por imóvel/planta/chave, os valores anteriores e cada URL adicionada em `image_url`, `images`, `520x280`, `1024x1024` e `2280x1800`. Não havia referência de imagem nessas plantas no arquivo anterior. IDs, ordem e metadados de plantas, retiradas somente as chaves de imagem, permanecem iguais.

A origem das atualizações foi comprovada por evidências convergentes:

- Logs de produção da Vercel, deployment `dpl_CafdnKRy7GGSQS2dpHpGzR5WHv55`, domínio app.yincorp.com.br, `POST /api/orulo-webhook`: eventos `BUILDING_UPDATE` e `ORULO_WEBHOOK_ACTIVE_PROCESSED` para os buildings correspondentes, com `propertiesSaved=1` e `propertiesSaved=2`.
- Requisição `ldqxq-1793814027499-9d7d349302ca` concluída às 14:40:29.389; requisição `g2n8j-1793815287504-4dccfa3d87ea` concluída às 15:01:29.024, horário de São Paulo.
- Logs Supabase nos mesmos intervalos mostram GET com filtro de building e POST `properties?on_conflict=external_id`, `resolution=merge-duplicates,return=representation`, cliente Node, HTTP 200. Esse é o fluxo de [orulo-webhook-core.js](https://github.com/mudeisp/ynteligencia/blob/7e7d8a3cb32ffbce9820c1197fb298f75ca3ba71/lib/orulo-webhook-core.js).
- Não há INTENT/CAS_RESULT desses três UUIDs no ledger do backfill. São sincronizações normais do webhook, anteriores ao merge #90, não uma recuperação auditada do lote.

As alterações serão preservadas: os três UUIDs ficam excluídos da proposta. A referência V2 armazena hashes de linha, não os valores comerciais antigos completos; portanto não se afirma que todos os preços/estoque históricos desses três eram idênticos. O estado atual será preservado pelo CAS integral e pelo baseline fresco da futura operação, sem rollback dos updates legítimos.

## Escopo restante e plano atualizado

| Item | Quantidade |
|---|---:|
| Manifesto original preservado | 33 UUIDs / 20 buildings |
| Já preenchidos, preservados e excluídos | 3 UUIDs / 2 buildings |
| Proposta restante | 30 UUIDs / 18 buildings |
| Ocorrências de plantas sem imagem | 122 |
| Plantas únicas e URLs primárias verificadas na origem | 73 |

Os 30 hashes completos e de conteúdo coincidem com a referência V2 anterior; os outros três divergem pelos updates auditados acima. A nova captura dos 33 registros mantém hashes completos, de conteúdo e de schema. Não há expansão de escopo ou alteração do manifesto original.

O [plano de preparação](orulo-phase1-122-prepared-plan.json) contém exatamente os 30 UUIDs, building IDs, 122 IDs de plantas, hashes atuais, URLs verificadas e exclusões. Hash da preparação:

`d4e754a434b363f52282cfe4607bf1f98cd75435d31f71919f85e472cfcd9428`

Algoritmo: SHA-256 de `JSON.stringify(plan)`, excluindo o envelope. O artefato tem tipo READ_ONLY_PREPARATION, `authorizationUsable=false`, sem Run UUID/GitHub Run ID e sem autorização. **Seu hash não substitui o hash de um futuro BATCH_PLAN ativo.**

A correspondência foi revalidada por GET no proxy público já existente, que consulta a Órulo: 18/18 buildings, cada ID de planta correspondente e 73 URLs primárias com assinatura JPEG/PNG/WEBP válida. As 24 URLs adicionadas aos três imóveis também foram verificadas. Não houve recuperação de secrets do GitHub nem sessão autenticada do runner nesta etapa; não se afirma validação visual de todas as imagens. O futuro executor consulta a Órulo autenticada e valida todas as dimensões efetivamente propostas, podendo gerar URLs/patches e um hash de plano diferentes desta preparação.

## Compatibilidade e teste

O executor atual aceita um subconjunto dos UUIDs do manifesto: `batch_inventory` retorna somente linhas que ainda possuem imagens ausentes; `executeBatch` exige cobertura exata desse inventário; a função administrativa compara UUIDs e IDs de plantas com o inventário atual. Nenhuma camada exige escrever nos três registros já preenchidos.

O novo teste carrega os 33 UUIDs reais com dados sintéticos, marca os três como preenchidos e confirma plano de 30 UUIDs, 18 buildings, 122 ocorrências e 73 URLs únicas. Confirma exclusão dos preenchidos, hashes inalterados, zero chamadas CAS e timeout seguro sem autorização. Executa apenas em PostgreSQL local isolado; não abre run no Supabase de produção.

Os testes de regressão e de PostgreSQL real existentes continuam verificando CAS integral, auditoria transacional, concorrência, timeout e preservação de campos. Os lotes seguintes permanecem `released=false`.

## Próximo passo, ainda não executado

Após revisão da preparação, solicitar ao proprietário a autorização para uma nova execução controlada de [orulo-batch-manual.yml](https://github.com/mudeisp/ynteligencia/actions/workflows/orulo-batch-manual.yml), main, phase1-20. Revisar separadamente o SHA exato aprovado pelo gate; este trabalho não altera flags ou configurações. Não disparar rerun antigo.

A execução futura deve refazer inventário e origem, apresentar BATCH_PLAN durável com Run UUID, GitHub Run ID, hashes e SQL preenchido. Somente então o administrador poderá autorizar esse plano ativo no SQL Editor. Após autorização, continuam obrigatórios baseline global V2 fresco, INTENT durável, CAS auditado, readback completo e parada em conflito/ambiguidade. Se o inventário mudar novamente, o plano deve refletir essa mudança; não forçar 30/122 usando um estado antigo.

Nenhum workflow operacional, WRITE_AUTHORIZED, CAS ou alteração de imóvel foi executado nesta preparação. Nenhum lote seguinte foi liberado.
