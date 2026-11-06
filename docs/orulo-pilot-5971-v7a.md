# Piloto 5971 — preparação V7-A

Esta alteração não autoriza escrita e não registra autorização ao ser instalada.
O V5, os 257 lotes nacionais, os quatro manifestos históricos, o piloto 43126 e
os recibos existentes permanecem intactos. Não há novo workflow, tabela ou ledger.

O piloto fixo `pilot-5971-images` reutiliza `executeBatch`, `authorize_pilot`,
`BATCH_IMAGES`, o journal PostgreSQL, snapshots, CAS, recibo e readback existentes.
Seu único UUID é `55701ebd-747e-4968-92f1-647d2e6a79d9` (SP, building 5971).
Só `image_url` das plantas 251614 e 251615 pode mudar; inclusive `updated_at`
é preservado. As duas URLs JPEG devem corresponder à fonte atual e passar
pela verificação de assinatura existente, com formato JPEG obrigatório.

A proposta V6 original foi preservada byte a byte; SHA256:
`4c6a3576d91fcca4f7c526daf7f62981df756dd9bab9bbb7f3b96a4d3c242eae`.
O hash é conferido pelo cliente e pela autorização/CAS no servidor contra o texto
original, não contra um hash informado isoladamente. `.gitattributes` impede
conversão CRLF/LF dessa evidência. O hash não é recibo de autorização.

## Revisão e instalação futura

1. Revisar o diff e a CI. Não mesclar ou executar por consequência desta preparação.
2. Revisar separadamente `supabase/orulo_pilot_5971.sql`. É uma adaptação de schema
   pendente, testada somente em PostgreSQL isolado/PGlite. Usa as assinaturas
   existentes, preserva ACL/owner e aborta a transação se os corpos revisados
   tiverem divergido. Não contém DML de imóveis nem emissão de autorização.
3. Uma futura instalação administrativa precisa de autorização própria. Não
   executar o SQL remoto nesta rodada. O catálogo novo ser revisável (`released`)
   não dispensa a aprovação administrativa explícita de um plano da execução.
4. A futura execução precisa usar um commit integrado revisado, proprietário,
   main, primeiro attempt e os gates existentes do executor. O workflow manual
   de lotes existente recebe somente a opção `pilot-5971-images`; suas condições,
   ambiente e secrets não mudam. Rever `ORULO_BATCH_APPROVED_SHA` para o commit
   integrado somente mediante autorização futura. O V5 e seu SHA não mudam.
5. Gerar um plano novo com leitura atual e fonte/CDN verificadas. O administrador
   aprova pelo `authorize_pilot` existente somente o hash do evento BATCH_PLAN,
   Run UUID, GitHub Run ID e commit correspondentes. O evento inclui o texto/hash
   V6, o UUID, as duas plantas/URLs e o hash atual completo da linha.

Antes do CAS, exige-se baseline posterior à autorização e leitura atual idêntica
à versão aprovada. O CAS bloqueia a linha e compara todos os campos novamente;
altera a coleção de plantas no `raw_data` atual, sem substituir o snapshot inteiro.
Um trigger alterando outro campo faz a transação reverter. As duas imagens são
uma única operação atômica, acompanhada pelo recibo transacional existente.

Um INTENT anterior para este UUID impede nova autorização automática; um resultado
CAS impede outro apply. Timeout/resposta perdida só permite recuperar o recibo e
conferir o estado, nunca repetir a mutação. Readback divergente interrompe o run e
exige investigação. Autorizações antigas/consumidas não são reutilizadas.

Os testes adicionados são incluídos no job de CAS já existente via package.json.
Nenhum secret, variável, SHA aprovado do dry run ou controle histórico foi alterado.
