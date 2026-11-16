# Órulo nacional — piloto de recuperação real, alvo 30701

## Alvo autenticado (16/11/2026)
- Run congelado: `1c8ec62a-9c38-41ac-8091-f1ceef98ca91`.
- Selo `NATIONAL_MANIFEST_SEALED`: sequência 6241, hash `80a16b13058c1dcf0e30fe1ef0ecceb5695f9bbd3ee56e740d1001d9514e968f`.
- Manifesto `ef04d42882f69166f5892efc0163a774814f5f26a7defeee83aa681efa725288`.
- UUID propriedade: `000a4d50-a014-4270-bb89-26adb841f142`.
- Órulo building `30701`; external ID `orulo:30701:49924`.
- Baseline de linha inteira congelada e conferida: `ca042e5572ce2421400b4f95e572b4802bf1966f837395103776521963e7e4d6`.
- Quatro patches de imagens em planos existentes, quatro atualmente vazios, nenhuma imagem preenchida conflitante. Consulta exata: [SQL de preflight](../scripts/orulo-national-pilot-30701-preflight.sql).
- A consulta executada na produção respondeu: `eligible=true, ledger_head=6241, expected_plans=4, empty_plans=4, missing_plans=0, populated_plans=0, invalid_desired=0`.
- Esta aptidão é **temporária**: é revalidada imediatamente antes de qualquer INTENT.

## Por que a infraestrutura atual não pode gravar esse alvo
1. `national_action=execute` registra fragmentos e chama `national_seal` de novo; o banco preserva corretamente o selo já existente.
2. `national_action=continue` exige `WRITE_AUTHORIZED` e `CONTINUATION_AUTHORIZED` que não existem.
3. `national_authorize` vincula os parâmetros ao GitHub Run ID e SHA **da origem do run** (`43003536521` / `e660a30cd78a56b1fea4beff3daa0b8c4a032a35`). Aprovar um novo workflow com credenciais históricas seria uma atribuição operacional incorreta.
4. O índice único `orulo_national_manifest_once` limita a uma autorização nacional por `manifestHash`, e `national_finish` espera **5.684** `CAS_RESULT UPDATED`. Criar uma autorização nacional completa apenas para testar quatro imagens deixaria a operação sem caminho de conclusão.
5. Uma autorização global, mesmo quando o código só envia um imóvel, não fornece isolamento de escopo **server-side**. O cliente NÃO é o controle de autorização.

## Contrato obrigatório do próximo desenvolvimento (não implementado neste PR)

- **Autorização administrativa por lote e piloto:** nova política explícita, com code SHA atual, GitHub run, lote/UUID fixo, hash do selo 6241, lease curta e escopo imutável; não reescrever `START`, `NATIONAL_TARGET` nem `NATIONAL_MANIFEST_SEALED`. O servidor deve recusar qualquer target fora do escopo, inclusive quando o cliente está comprometido.
- **Sequência de eventos compatível:** um piloto do lote 1 precisa ter seu próprio recibo de aprovação, INTENT, CAS_RESULT e readback **dentro do ledger transacional existente**, sem autoria falsa. A unicidade por manifesto e o controle de continuidade devem permitir autorizações disjuntas dos lotes subsequentes.
- **Snapshot global:** capturar `BASELINE_V2` no protocolo de autorização atual antes de gravar; manter `STRICT_GLOBAL_V1` e checar `columns_v2()`.
- **Reutilização do motor:** o único escritor continua o mecanismo `audited_cas_core`/CAS com `FOR UPDATE`, comparação de linha inteira, patch exclusivo de `images` vazias, recibo na mesma transação e readback. Sem PATCH, UPSERT, atualização direta, rebaseline, alteração de `updated_at` nacional ou retries de CAS ambíguo.
- **Idempotência:** `ALREADY_COMPLETE` pode ser estado diagnosticado, mas nunca um `CAS_RESULT UPDATED` fictício. Os 157 imóveis completos no lote 1 e 1.539 nacionalmente não podem ser usados para satisfazer contagem de writes inexistentes.
- **Exceções:** isolar 13 imóveis divergentes incompletos (lote 1), 140 nacionalmente, e 110 plantas ausentes nacionalmente; nenhuma alteração silenciosa no manifesto aprovado.
- **Testes obrigatórios:** PostgreSQL real de CAS e rollback, concorrência com webhook, impossibilidade de UUID fora do escopo, ausência/expiração da autorização, lease, replay, timeout antes/depois do commit, readback, duplicidade, cadeia do ledger e retomada disjunta entre lotes.

**Status:** apenas o alvo do piloto foi concretamente fixado e verificado. Este PR **não contém migração ou executor de escrita**; não executar autorização histórica ou CAS manual até um protocolo de lotes ter CI PostgreSQL e aprovação administrativa específica. A operação nacional continua `head=6241`, `WRITE_AUTHORIZED=0`, `INTENT=0`, `CAS_RESULT=0` na última consulta.
