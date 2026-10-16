# Paid Push / Match IA: diagnóstico de entrega

Auditoria de 16/10/2026, somente leitura do domínio Production.

## Evidência HTTP

Duas requisições GET a `https://app.yincorp.com.br/`, com intenção
`modo=explorar&bairro=Pinheiros&dormitorios=2`, receberam o HTML anterior
à integração do PR #21. A segunda usou query inédita e `Cache-Control: no-cache`.

SHA256 dos dois corpos recebidos:
`580793a83fcdb9e0e247772fb1dd356ba4c0ef2f0d3b3a77be68978591b2e4c1`.

Os corpos são idênticos, byte por byte, ao `index.html` de
`713a9299cb2f3fb1771718817c6ba3b2e092ae49`, e diferentes da main
`2383b9778b4c7aaa323303944e6c4b813a8f9231`.

O HTML recebido não contém `paidPushSheet`, `paidSearch` nem
`yntHasPaidClickContext`. Seu `scheduleAiAssistantForProperty()` agenda
`yntOpenProactiveAiForProperty()` após 5000 ms. Essa função abre
`aiAssistantShell`, insere o texto “Quer que te mando outras opções por dia
sem deixar email ou whatsapp?” e chama `yntAppendProactiveVipActions()`.
Esse é o componente legado correspondente ao relato.

Isso comprova divergência do artefato servido pelo domínio; não identifica,
por si só, qual configuração de deployment/alias/origem causou a divergência.
Nenhum deployment, alias, cache ou configuração foi alterado nesta auditoria.

## Proteção adicional no código

A main já protege o agendamento e seu callback com o contexto normalizado.
Agora o próprio opener legado também recusa contexto pago antes de tocar
no estado da IA ou criar seu shell. A abertura manual permanece independente.
Os elementos recebem identificadores `data-retention-experience` distintos:
`paid-push` no Paid Push e `match-ai` no shell da IA.

## Verificação necessária na entrega

Antes de atribuir o resultado em Production a este patch, verificar qual
artefato o domínio realmente entrega. O HTML deve conter o Paid Push e suas
proteções. Um deployment READY, isoladamente, não prova essa associação.
Após entrega autorizada do artefato correto, retestar dois imóveis distintos:
nada no primeiro; apenas Paid Push ao voltar do segundo. Não foi realizado
merge ou deployment como parte desta correção.
