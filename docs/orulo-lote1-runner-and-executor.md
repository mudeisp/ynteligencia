# Lote 1: parada do runner e executor protegido

Base desta correção: main `a6633858ee2655fe2711cc211fa6d0e8456ab06a`.

## Parada antes do próximo registro

Em modo de escrita, o runner agora lança erro imediatamente em CONFLICT, NOT_FOUND ou AMBIGUOUS. `ambiguousResponse=true` sempre interrompe, inclusive quando o readback encontra o estado desejado e o helper retorna UNCHANGED: observar o estado não prova autoria nem permite continuar após timeout. Somente UPDATED/UNCHANGED confirmados podem continuar.

Falhas na fonte, leitura fresca, RPC, readback, preservação de campos ou gravação de ledger também encerram o lote. Requisições de autenticação, listagem e plantas passam a ter timeout limitado a 30 segundos; os sinais de timeout já fornecidos pelo helper CAS são preservados. Não existe retry automático de mutação.

Os eventos CAS originais (INTENT, RESULT, PREWRITE_READ_FAILURE, READBACK_AFTER_AMBIGUOUS_RESPONSE, POST_WRITE_DIVERGENCE) não mudam. Após a falha, o runner tenta acrescentar um STOP sincronizado pelo mesmo ledger, com building ID, UUID quando conhecido, erro e contagem de resultados confirmados. O erro original e o resumo parcial ficam disponíveis em `error.recoverySummary`. Se o próprio STOP não puder ser gravado, a falha adicional é diagnosticada em `error.ledgerError`/stderr e o processo continua interrompido; nunca substitui a falha original ou avança para outro ID. O CLI termina com código diferente de zero.

Nenhuma operação anterior é desfeita automaticamente: uma interrupção pode ocorrer depois de um commit ou depois de atualizações anteriores confirmadas. Reconciliar baseline V2, ledger e readback antes de decidir qualquer nova tentativa. Um contador parcial isolado não comprova o estado completo da execução. Abertura exclusiva, fsync, leitura por PK, escopo de 99 IDs, comprovantes CAS e proteções SQL permanecem inalterados.

## Testes

`node scripts/orulo-media-recovery-stop.test.mjs` executa 21 casos com transporte totalmente interceptado e credenciais fictícias no worker de teste. Exercita os caminhos do runner em memória; não executa o CLI operacional com --write e não acessa Órulo/Supabase reais. Inclui falhas no primeiro UUID e depois de uma atualização confirmada, nenhum UUID posterior do mesmo building, nenhum building posterior, timeout antes/depois do commit simulado, readback ausente/falho, divergência de preço ou metadados simulada em fixture, resposta inválida, falhas de ledger e arquivo JSONL real exclusivo preservado após a rejeição.

`npm test --prefix test-support/orulo-cas` inclui esses testes e a suíte CAS existente com PGlite fixado. O workflow isolado existente executa a suíte sem credenciais de produção. Nenhum SQL, manifesto ou contrato da RPC foi alterado.

## Variáveis Vercel: metadados somente

Conferência em 2026-11-04, por listagem com `decrypt=false`, sem solicitar, ler, registrar ou copiar valores secretos:

Projeto correto: **ynteligencia**, `prj_wdLbJbBn59Ho8ZjdUVau3ADNDyT8`, equipe `rafael-8f11`. Domínio de produção: `app.yincorp.com.br`.

| Variável | Production | Preview | Development | Tipo |
| --- | --- | --- | --- | --- |
| ORULO_CLIENT_ID | Configurada | Configurada | Não listada | sensitive |
| ORULO_CLIENT_SECRET | Configurada | Configurada | Não listada | sensitive |
| SUPABASE_SECRET_KEY | Configurada | Configurada | Não listada | sensitive |

Não há override de branch nem customEnvironmentIds nos três registros listados. Esta verificação comprova configuração/escopo, não validade dos valores ou sucesso de autenticação. O projeto separado **ynteligencia-app**, `prj_9cVMcz57ZPvzqXaxcGRPTqaYhgPw`, não lista essas três variáveis; seu hiddenProductionEnvCount é zero. Evitar confundir os dois projetos.

## Executor: bloqueio exato

- O executor cloud deste trabalho não possui as três variáveis nem secret bindings configurados.
- Foram listados três sandboxes no projeto correto: `orulo-floorplans-write`, `orulo-floorplans-dryrun` e `temp-unused-check`. Todos estão **stopped** e **persistent=false**. A listagem não demonstra volume durável ou binding das variáveis sensíveis. Nenhum sandbox foi iniciado, retomado ou alterado.
- O workflow GitHub Actions existente é exclusivamente de testes com credenciais fictícias; não é um executor operacional aprovado com secrets de produção e ledger durável.
- As variáveis disponíveis no runtime de uma aplicação Vercel não implicam que um CLI separado/sandbox as herde. Não foi identificado um caminho operacional já autorizado que execute o backfill com injeção nativa dessas credenciais e persistência do ledger, sem extrair/copiar seus valores. Uma rota pública de execução não é solução aceitável.

## Recomendação para liberar a execução

1. Revisar este PR e seus testes; não iniciar lote com o runner anterior.
2. O responsável pela plataforma deve disponibilizar um job/runner **privado** já autorizado, com Node 22+, checkout do SHA aprovado e disco/volume durável. As três credenciais existentes precisam chegar ao processo por binding/injeção do gestor de segredos na origem, sem env pull, exportação de valores, novos tokens, logs de ambiente ou entrega das chaves ao agente. Não há evidência de que os sandboxes listados tenham esse binding; ele precisa ser comprovado pelo responsável antes de execução.
3. Verificar apenas presença das variáveis, identidade do projeto, acesso aos endpoints oficiais e durabilidade do volume. Se a plataforma não oferecer esse binding sem exportação, a alternativa é o operador executar no ambiente protegido que já recebe as variáveis; não transferi-las para este executor.
4. Depois de autorização específica e do código aprovado, capturar baseline V2 fresco por UUID imediatamente antes da escrita, criar ledger exclusivo novo nesse volume e restringir a execução ao manifesto de 99 IDs. Qualquer STOP exige reconciliação manual; não reaproveitar automaticamente um ledger/operação incerta.

**Situação operacional: execução ainda bloqueada até existir e ser comprovado esse executor protegido.** Ter as variáveis configuradas na Vercel, por si só, não resolve a ausência de executor/durabilidade.

Nesta etapa não houve --write operacional, lote, dry-run completo, alteração de imóveis, mudança de ACL da RPC, criação de token ou rota pública, merge ou chamada de deploy. Nenhum valor secreto foi recuperado.
