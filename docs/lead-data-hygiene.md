# Higiene do lead

`ads_events.lead_created` continua sendo a authority do lead. Este documento não muda essa authority, não cria lifecycle e não aplica migration.

## O que cada sink é

- `public.ads_events`: authority. O `event_id` confirmado por `record_ads_lead` é o id lógico do lead. A janela de 15 minutos por `visitor_id` + `property_id` permanece em `public.record_ads_lead`.
- `public.leads`: storage operacional, uma linha por submit lógico. O writer único do app é `POST /api/lead`, com service role. `metadata.lead_event_id` guarda o mesmo id opaco para correlação. Esse campo não é chave primária.
- `public.events`: telemetria de produto. O `lead_created` dessa tabela leva `visitor_id`, `session_id`, imóvel, origem, `lead_event_id` e `success`. Não leva nome, telefone, e-mail, `lead_summary` nem conversa.
- GA4, Meta Pixel, Google Ads e o e-mail operacional são espelhos de entrega. Não são authority.

## Write operacional

O browser não faz `POST` em `public.leads`. O insert antigo com a publishable key foi removido. Ele repetia a linha da API e ainda gravava `source: "ynteligencia"` e `crm: "praedium"` mesmo quando a origem era Match IA e o Praedium não tinha sido chamado.

O que esse insert tinha de útil e a API ainda não guardava passa no body de `/api/lead` e fica no metadata da linha única:

- `session`: número, retorno, sessão anterior e dias desde a visita anterior
- `declared_profile`: respostas do wizard sem telefone nem e-mail
- `touches`: first, current e previous touch, com os clique ids preservados

`metadata.profile` continua sendo o texto `perfil` já aceito pela API. O wizard não substitui esse campo.

## Idempotência de public.leads

O dedupe é `lead_event_id` mais o contexto lógico. Os três campos do contexto são os valores já limpos do request: `session_id`, `metadata.visitor_id` e `metadata.property.id`.

Quando `lead_event_id` casa com `^[A-Za-z0-9_-]{8,80}$`, a API consulta até 20 linhas com esse id. Uma linha só conta como o mesmo lead se os três campos casam. Nesse caso não há outro insert e a resposta segue `supabase: true`. O cliente reutiliza o id de `sessionStorage` por 15 minutos, o mesmo id enviado a `ads_events`.

Se o id existe e sessão, visitante ou imóvel divergem, a API não trata isso como sucesso duplicado e não altera a linha existente. A resposta é `409` com `error: "lead_event_id_conflict"` e `supabase: false`. O corpo e o log não levam nome, telefone, e-mail nem resumo. E-mail e Meta CAPI não disparam nesse retorno.

Se a consulta falha, a API insere assim mesmo. Isso continua sendo best-effort até o schema de produção e uma constraint única serem verificados. Não há índice único neste repositório. Duas requisições simultâneas com o mesmo id e o mesmo contexto ainda podem criar duas linhas. Reload sequencial do mesmo contexto não cria a segunda.

Sem `lead_event_id`, o comportamento anterior permanece: um insert por request. E-mail, Meta CAPI e Praedium não passaram a ser idempotentes.

## public.events

DDL e RLS de `public.events` e de `public.leads`: **NOT VERSIONED IN REPOSITORY**. **PRODUCTION SCHEMA REQUIRES VERIFICATION**. Nenhuma migration foi aplicada e nenhuma policy foi inventada.

O browser continua inserindo telemetria que não é lead com a publishable key. `api/push-daily.js` lê `public.events` no servidor para assinatura, histórico e `push_sent`. Esse leitor não usa nome, telefone, e-mail, resumo nem conversa.

## O que permanece com PII

`public.leads`, o e-mail de atendimento e o webhook Praedium de origens que não são Ynteligencia carregam nome, telefone e e-mail porque a entrega precisa deles. O navegador ainda guarda o contato em `localStorage` para preencher o formulário e abre o WhatsApp com o nome na mensagem. Isso não é authority.
