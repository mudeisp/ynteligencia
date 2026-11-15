# Órulo National V2 — benchmark SQL por etapa

**Data:** 15/11/2026. **Ambiente:** branch Supabase isolada `orulo-national-seal-benchmark-readonly-data` (`uligzyjffzbjdzaqffvp`). Produção foi consultada somente por `SELECT`.

**Objetivo:** descobrir a etapa dominante do caminho de `national_seal` após HTTP 500 / SQLSTATE 57014 da execução GitHub Actions #53 de 11/11/2026. **Não houve migration de selo, autorização, execução de CAS ou alteração de produção.**

## Preparação e integridade

- O provisionamento automático das migrations na branch reportou `MIGRATIONS_FAILED`. Por isso, a medição foi realizada em esquema **exclusivo de benchmark** (`seal_bench`), reproduzindo as expressões centrais da função antiga, **sem executar a RPC real `orulo_audit.national_control`**.
- A branch recebeu por leitura do banco principal os **6.240 eventos completos**: 1 `START`, 555 `NATIONAL_MANIFEST_PART`, 5.684 `NATIONAL_TARGET`. Sequências 1–6240 consecutivas, sem duplicidade, preservando UUID e JSON original.
- O hash do texto reconstruído é exatamente `ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288`. A comparação estrutural de todos os 5.684 alvos registrados com o documento reconstruído retornou `true`.
- Fragmentos originais: **72.634.081 bytes UTF-8**. Alvos persistidos: **79.166.441 bytes em `pg_column_size(event->'target')`**, diferente de tamanho em JSON texto. Array agregado: 79.181.889 bytes em representação JSONB; documento interpretado: 79.183.576 bytes.
- Evidências/contagens conferidas: **42.893 patches**, **2.116 empreendimentos**, **128.679 ocorrências de URL**, **39.525 URLs distintas**, zero patches com `validation`, `sourceChunk` ou `sourceResultSha256` inválidos na validação implementada.

## Medições reais em milissegundos — 3 execuções por etapa

| Etapa | Execução 1 | Execução 2 | Execução 3 | Mediana (ms) | Dados envolvidos |
|---|---:|---:|---:|---:|---|
| 01. `string_agg` dos 555 fragmentos | 445,58 | 447,29 | 453,89 | **447,29** | 72.634.081 bytes de texto |
| 02. `sha256(convert_to(payload,'UTF8'))` | 331,21 | 301,80 | 475,83 | **331,21** | 72.634.081 bytes |
| 03. `payload::jsonb` | 5.706,13 | 5.719,86 | 2.093,20 | **5.706,13** | 79.183.576 bytes JSONB |
| 04. `jsonb_agg` dos 5.684 alvos ordenados | 2.520,49 | 2.347,93 | 1.605,16 | **2.347,93** | 79.181.889 bytes JSONB |
| 05. Igualdade `doc->'targets' = expected` | 464,53 | 564,85 | 613,00 | **564,85** | 158.363.778 bytes (dois arrays JSONB) |
| 06. Evidências, contagens, edificações e URLs distintas | 2.239,44 | 2.208,55 | 2.506,28 | **2.239,44** | 79.181.889 bytes JSONB |

A etapa **03 — parse integral do JSONB** dominou as medianas: **5.706,13 ms**, cerca de 49% da soma das seis medianas (11.636,85 ms). A amplitude do parse (2.093–5.720 ms) mostra variação relevante: 3 execuções são diagnóstico inicial, não distribuição estável.

### Testes específicos do timeout padrão

Na produção, o role `authenticator` possui configuração `statement_timeout=8s` em `pg_db_role_setting`. A branch recebeu explicitamente esse timeout **apenas durante a prova**.

1. **Concatenação + SHA-256 real**: 1.407,62 / 653,12 / 618,23 ms; **mediana 653,12 ms**, hash correto em todas as execuções. **Conclusão:** o hash completo **cabe no timeout de 8 s**, com margem significativa na branch.
2. **Fluxo integral com limite de 8 s**, reproduzindo concatenação, hash, parse, agregação, igualdade e parte da validação de evidências: **SQLSTATE 57014** durante `jsonb_agg(event->'target' ...)`. Esse é o estágio onde expirou o orçamento acumulado nessa reprodução, **não prova que a agregação isolada seja a mais lenta**.
3. **Fluxo integral com timeout de 5 minutos, sem `NATIONAL_MANIFEST_SEALED` e sem writes no ledger:** **13.790,50 ms**, 42.893 patches, 2.116 edifícios e 39.525 URLs distintas. Apenas **uma** execução integral; não interpretar como mediana.

## Fato, hipótese e limites

- **Fato:** o incidente #53 teve timeout SQLSTATE 57014 e o executor reportou `NATIONAL_HALTED_RECONCILIATION_REQUIRED`. O benchmark da branch reproduziu 57014 com limite de 8 s e apontou o **parse** como a etapa isolada de maior mediana.
- **Hipótese fortemente sustentada:** o problema operacional do selo atual é o **orçamento acumulado de execução da validação integral** sob o timeout do role PostgREST, não o cálculo SHA-256.
- **Lacuna:** as migrations originais não foram implantadas na branch; logo não houve medição da função real end-to-end, incluindo RLS, locks, `columns_v2()` e append. As seis expressões reproduzem as operações centrais; ainda não é medição direta do ambiente de produção.
- **Lacuna:** a expressão de evidências da etapa 06 mede campos e contagens da rotina antiga, não uma nova verificação binária remota das URLs. Não revalidamos origens externas.
- **Lacuna:** nenhuma medição direta de peak memory/RSS. Os tamanhos de `pg_column_size` não equivalem à memória máxima do backend.
- **Lacuna:** recursos e caches da branch não são necessariamente idênticos aos da produção.

## Estado do ledger em produção (última consulta, somente leitura)

- Cabeça: sequência **6240**.
- `NATIONAL_MANIFEST_SEALED`: **0**; `WRITE_AUTHORIZED`: **0**; `INTENT`: **0**; `CAS_RESULT`: **0**.
- Eventos `NATIONAL_HALTED_RECONCILIATION_REQUIRED` ou `NATIONAL_RECONCILIATION_REQUIRED` no ledger: **0**.
- Interpretação: `NATIONAL_HALTED_RECONCILIATION_REQUIRED` foi estado/falha **do runner**, não um novo evento persistido no ledger. Não há transação CAS nacional pendente. O manifesto permanece **não selado**, exigindo retomada governada, mas o nome do erro **não comprova divergência** registrada no ledger.

## Decisão técnica

**Não implementar migration nesta entrega.** O resultado concentra o diagnóstico no parse e na agregação do documento completo e indica que a correção incremental deve reduzir o trabalho acumulado sob 8 s, sem relaxar identidade do SHA nem igualdade de escopo. PR #125 permanece **draft**, sem autorização de deploy. Esta medição não é autorização para repetir o SQL integral em produção.

A branch é descartável; a exclusão encerra a cobrança e preserva este relatório no GitHub.
