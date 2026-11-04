# Registro do workflow manual Órulo

## Diagnóstico em 4 de novembro de 2026

A API do repositório confirma `default_branch=main`. A main `43e32a2b26e625be58bc6c19625ea9d7eebfe847` contém `.github/workflows/orulo-batch-manual.yml`, integrado pelo PR #88. O nome é `Orulo progressive manifest batches (admin authorization required)`.

Consulta pública, sem credenciais:

- `GET /repos/mudeisp/ynteligencia/actions/workflows`: HTTP 200, seis workflows registrados, sem o workflow batch.
- `GET /repos/mudeisp/ynteligencia/actions/workflows/orulo-batch-manual.yml`: HTTP 404.
- O arquivo raw na main existe e configura somente `workflow_dispatch`. A versão anterior e a correção passaram em actionlint 1.7.7 (YAML, schema e expressões; integrações opcionais shellcheck/pyflakes desabilitadas).

A evidência comprova ausência no catálogo Actions, apesar do arquivo válido na branch padrão. Não comprova a causa interna do indexador do GitHub. A correção fornece um evento de registro explícito, sem usar um disparo operacional para tentar registrar o arquivo.

## Correção

Acrescentar `push` exclusivamente na main e exclusivamente quando este mesmo arquivo de workflow mudar. O único job permitido nesse evento, `register`, tem permissões vazias, limite de um minuto, nenhum checkout, Environment, variável, secret, ação externa ou chamada de rede. Executa somente um `printf` constante.

`gate` e `batch` têm condições idênticas: `workflow_dispatch`, main, proprietário mudeisp/323805541, mesmo iniciador e primeira tentativa. `batch` continua dependendo de `gate`. Push nunca acessa credenciais, gera plano, solicita autorização, consulta Supabase/Órulo ou altera imóveis.

Continuam preservados: checkout por SHA exato, flags de prontidão e SHA aprovado, manifesto imutável, Environment `orulo-lote1`, concorrência única sem cancelamento, proibição de reruns, autorização administrativa por plano, ledger, CAS e integridade. Os manifestos/catálogo/migrações não foram alterados; lotes `phase2-30-a`, `phase2-30-b` e `phase3-rest` continuam com `released=false`.

## Verificação após merge autorizado pelo proprietário

Este PR não é mergeado automaticamente. Antes de seu merge, o arquivo corrigido ainda não está na main; não se deve afirmar que o GitHub já registrou a correção.

1. Após aprovação e merge, a alteração deste arquivo na main produz somente a execução inofensiva de registro. Confirmar `register=success`, `gate=skipped` e `batch=skipped`.
2. Consultar os dois GETs acima e confirmar o workflow no catálogo, com o nome correto e estado `active`.
3. Abrir [a página do workflow](https://github.com/mudeisp/ynteligencia/actions/workflows/orulo-batch-manual.yml). Não clicar em Run workflow para fazer essa conferência.
4. Se ainda retornar 404 após processamento, conservar a evidência e investigar o registro no GitHub; não contornar as condições operacionais, não emitir autorização e não disparar recuperação.

Registrar o workflow não aprova uma nova revisão do executor. O SHA operacional deve ser revisto separadamente antes de qualquer alteração de `ORULO_BATCH_APPROVED_SHA`/prontidão. Este PR não altera essas variáveis.

## Testes

Os testes existentes do executor agora permitem apenas o novo push estritamente limitado. O novo teste verifica filtros exatos, job de registro inofensivo, dependência de gate e igualdade das condições operacionais. Avalia a matriz manual/push/PR/schedule/workflow_run, branches, identidade e tentativa; confirma que push só habilita registro e que fases posteriores continuam rejeitadas. A validação actionlint cobre a sintaxe real do arquivo, além dessas verificações de segurança. O CI existente executa regressão isolada e PostgreSQL real, sem credenciais de produção.

Nenhuma migração, WRITE_AUTHORIZED, alteração de imóvel ou dispatch operacional integra esta correção.
