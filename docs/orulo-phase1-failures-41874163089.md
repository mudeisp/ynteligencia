# Diagnóstico phase1-20 — 4 de novembro de 2026

## Evidência e limites

Ambas as execuções usaram main `28ab08da76e0523a7ef886278b8825565fe22ac8`, tentativa 1, proprietário mudeisp, e terminaram `completed/failure`. O gate passou nas duas. Não é necessário modificar seu comportamento.

### 41874163089 / 55c664a5-e24d-4527-a7aa-68b0da01f039

O GitHub publicou somente `BATCH_BLOCKED` às 17:06:56 UTC. O ledger original contém START e CLIENT_STOP, sem BATCH_PLAN, autorização, INTENT, CAS_RESULT ou captura V2. STOP tem `id=null`, `confirmedRows=0`, `verifiedRows=0`.

No intervalo, os logs do gateway Supabase mostram respostas RPC HTTP 200, sem erro PostgreSQL para esta primeira execução. Depois da sequência de leituras, há um intervalo entre 17:06:27 e 17:06:56, seguido das duas chamadas bem-sucedidas do STOP e de sua confirmação. A falha ocorreu antes de persistir o plano; a duração é compatível com falha/espera na preparação da origem, mas **não prova timeout, HTTP específico, OAuth ou building específico**.

A causa técnica comprovada de perda do diagnóstico está no código: o CLI aceita apenas mensagens com prefixos BATCH/POSTGRES e substitui as demais por BATCH_BLOCKED. O fetch nativo e `ORULO_FLOOR_PLANS_FETCH_FAILED_<status>` ficam sem causa visível; o STOP anterior também não registrava etapa/código da origem. O registro histórico não permite recuperar com certeza a exceção original. Não atribuir essa primeira falha à pendência criada depois por ela mesma.

### 41874451716

GitHub: `POSTGRES_AUDIT_RPC_FAILED`, `start`, HTTP 400, SQLSTATE P0001 às 17:07:58 UTC. O log PostgreSQL aponta `orulo_audit.control_v1` linha 17. A definição instalada dessa linha é exatamente a exceção `AUDIT_ACTIVE_RUN_REQUIRES_RECONCILIATION`. Havia uma única execução aberta: 55c664a5-e24d-4527-a7aa-68b0da01f039. Portanto a causa desta segunda falha é comprovadamente a proteção de execução anterior aberta, não timeout, falha de credencial ou schema cache.

Nenhum registro de run foi criado para 41874451716. Não há Run UUID persistido nem cadeia onde acrescentar ABORTED para esse GitHub Run ID. Não inventar uma execução para encerrá-la.

## Integridade e comunicação

- `batch_inventory('phase1-20')` responde e retorna os mesmos 33 UUIDs/20 buildings, master hash `d670eb2cc7ab60cfc76e0ef08b466e9c9b503df64047d57519a34e7ed57f63b2` e manifesto `7f4299ab3eacf2ee5509487ca1f0adc71ee0425bd945f088b086ec7797cad97a`.
- Os 33 imóveis existem, ativos, source novos, SP, e cada building corresponde ao manifesto. Hash completo e hash de conteúdo de todos os 33 coincidem com a captura V2 autenticada anterior: READBACK_V2 de `98a9afa9-a08d-46f1-bef9-4d4e670c786f`, selada em 2026-11-04 14:43:39 UTC. Zero diferenças, inclusive de timestamp. A cadeia da referência e os registros de página foram conferidos.
- Não há INTENT sem CAS_RESULT para esta execução ou para os 33 UUIDs. Nenhum CAS desta execução foi executado.
- Verificação atual e sem credenciais: o endpoint Órulo de plantas do building 3198 responde HTTP 401, como esperado sem token. O proxy GET existente `app.yincorp.com.br/api/development?building_id=3198` responde HTTP 200, com os três IDs de plantas esperados. Isto comprova acessibilidade atual, não reconstrói a comunicação/credenciais do runner durante o incidente. Não houve nova auditoria dos 83 buildings.

## Reconciliação realizada

Após confirmar encerramento GitHub, cadeia SHA-256, escopo, hashes completos e ausência de operações, foi acrescentado somente ABORTED como evento 3 de 55c664a5-e24d-4527-a7aa-68b0da01f039. A transação revalidou o head esperado e preservou integralmente os dois eventos originais; leitura de confirmação validou a cadeia. Os imóveis foram apenas lidos/bloqueados para conferência, nunca alterados.

Hash final: `8bcc4c2ee0c3ea9f3d47535cae5d1bd8384e9a674e7c8bf2934f8635a1f83641`.

41874451716 não requer append, pois o start rejeitado não criou run. Após a reconciliação havia zero runs abertos. A operação não emitiu autorização nem iniciou workflow.

## Correção proposta

O executor registra no STOP e no CLI um diagnóstico estruturado de etapa, building pertencente ao manifesto, serviço/operação, HTTP e categoria limitada de erro de rede. OAuth, leitura de plantas, JSON inválido, CDN, RPC e espera por autorização ficam distinguíveis. Nenhum corpo de resposta, token, URL livre, stack, SQL, hint/details ou mensagem arbitrária é emitido.

O transporte PostgreSQL permite apenas constantes exatas de uma lista fechada de motivos de segurança, além do SQLSTATE/status/ação já permitidos. O start conserva seu UUID gerado para conferência somente leitura se houver falha ou resposta ambígua. Mensagens desconhecidas continuam redigidas, com etapa segura; prefixo BATCH sozinho não torna uma mensagem confiável.

Sem migrations, alterações de ACL/RLS/CAS, revisão de manifesto, aumento de timeout, retries ou reconciliação automática. A proteção de run aberto permanece ativa. Lotes seguintes continuam bloqueados. O problema de observabilidade é corrigido; não se afirma que uma falha transitória de origem não identificada foi eliminada. Uma próxima tentativa operacional exige aprovação separada do novo commit e autorização administrativa de plano novo; este PR não a executa nem autoriza.

Testes cobrem HTTP/timeout de OAuth, HTTP/JSON de plantas, falha da CDN, redaction, códigos exatos do PostgreSQL, UUID em start incerto e persistência de STOP antes de qualquer autorização/CAS. A regressão e os testes PostgreSQL existentes continuam obrigatórios.
