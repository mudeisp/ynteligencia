# Contrato de handoff entre YNTELIGENCIA e AGENTE.YINCORP

A YNTELIGENCIA continua a descoberta de imóveis. O AGENTE.YINCORP continua o projeto conversacional, na URL `https://agente.yincorp.com.br/`. Este repositório não contém o código do agente e não o incorpora.

O handoff transporta contexto sem PII e sem aumentar o número de Serverless Functions. Tudo passa pela function já consolidada `/api/ads`.

## Ativação

Variável de ambiente somente no servidor da YNTELIGENCIA:

`ADS_AGENT_HANDOFF_ENABLED`

O valor exato `true` liga o fluxo. Qualquer outro valor, inclusive vazio ou ausente, deixa o fluxo desligado. Não existe equivalente `NEXT_PUBLIC`. O navegador não lê essa variável.

Com a flag desligada:

- `POST /api/ads?action=create-handoff` responde `409` com `{ "success": false, "error": "handoff_disabled" }`.
- Nenhuma linha é gravada em `ads_handoffs`.
- A YNTELIGENCIA não abre `https://agente.yincorp.com.br/`.
- **Conversar com a IA** e **I.A ajuda** continuam em `openAiAssistant`, a Match IA da ficha.
- **Falar com especialista** continua em `openPropertySpecialist` → `openLeadCapture` → `/api/lead`.
- A Match IA da home permanece no próprio app.

Com a flag ligada, esses dois botões da ficha pedem o handoff e abrem a URL devolvida em uma nova aba.

## Origem da API

Origem de produção da YNTELIGENCIA Ads API:

`https://app.yincorp.com.br`

O AGENTE consome essa API no servidor, com a variável `YNTELIGENCIA_ADS_ORIGIN`. Essa variável também não é `NEXT_PUBLIC`.

```
POST ${YNTELIGENCIA_ADS_ORIGIN}/api/ads?action=get-handoff
POST ${YNTELIGENCIA_ADS_ORIGIN}/api/ads?action=event
```

Em produção, `YNTELIGENCIA_ADS_ORIGIN` é `https://app.yincorp.com.br`. O Agent não usa caminho relativo. Um `POST /api/ads` relativo cairia no próprio host do agente.

## Token

A URL aberta, só quando a flag está ligada, tem um parâmetro:

`https://agente.yincorp.com.br/?handoff=<token>`

O token tem 32 bytes aleatórios, codificados em base64url (43 caracteres). Vale 15 minutos. É transitório. Não é identidade do usuário, não é `visitor_id` e não carrega nome, telefone, e-mail, resumo nem transcrição.

O Agent remove `handoff` da URL antes de persistir:

- `landing_path`
- `landing_params`
- analytics
- prompt
- memória
- extras
- logs de aplicação quando forem controláveis

O corpo de sucesso de `get-handoff` não repete o token.

## O que o AGENTE.YINCORP precisa implementar

### 1. Ler o token só da própria URL

Ao carregar `?handoff=`, o agente envia o token no corpo, a partir do servidor:

`POST ${YNTELIGENCIA_ADS_ORIGIN}/api/ads?action=get-handoff`

```json
{ "handoff_id": "<token>" }
```

Origem CORS permitida, se a chamada sair do browser: `https://agente.yincorp.com.br`. A chamada prevista é server-side.

Respostas de `get-handoff`:

| HTTP | `error` | O que o agente faz |
|---|---|---|
| 200 | — | Handoff válido. Usa `visitor_id`, `session_id` e `context` |
| 400 | `handoff_malformed` | Requisição ou token malformado. Conversa normal, sem contexto |
| 404 | `handoff_invalid` | Token inexistente ou inválido. Conversa normal, sem contexto |
| 410 | `handoff_expired` | Token expirado. Conversa normal, sem contexto |
| 405, 500, 502, 403 e qualquer outro erro de infraestrutura | varia | Falha de integração. O agente continua como conversa normal |

O receptor não classifica um 404 só pelo status. Confere o campo `error`. `404` com `handoff_invalid` é token desconhecido. Outro 404 não é esse caso.

Nenhum desses casos pode quebrar a entrada direta, que continua sem `handoff`.

### 2. Identidade

O handoff válido traz `visitor_id` e `session_id`. Os dois são UUIDs na YNTELIGENCIA.

O Agent valida os dois com o formato UUID. Quando forem válidos, reutiliza esses valores. Não gera outro `visitor_id`. Não lê `?vid=` nesta URL.

`session_id` vale para a transição da mesma jornada. Se o UUID da sessão for inválido, o Agent cria a sessão local e não reaproveita o valor inválido.

A atribuição recebida em `context.attribution` entra na criação de uma sessão nova do Agent, quando essa sessão ainda não existir. Uma sessão que já existe conserva a atribuição histórica. O handoff não a reescreve.

Sem handoff, vale a lógica local já existente do agente.

### 3. Contexto

`context.property` é o imóvel atual. O mesmo objeto também vai em `context.current_property`.

`context.property.property_id` é o `external_id` do inventário, o identificador do provedor. Exemplos: `orulo:...` e `nonstop:...`.

Não é o UUID interno de `public.properties`. Se `db_id` vier preenchido, é só esse UUID, em campo separado. O receptor não trata `property_id` como `db_id`.

O restante do contexto:

- `declared_intent`: busca que estava na tela
- `first_declared_intent`: primeira busca gravada, quando existir
- `current_declared_intent`: busca gravada mais recente, quando existir
- `observed_intent`: calculada no servidor, quando existir. O cliente não define esse campo.
- `recent_properties`: até 8 imóveis vistos, com o mesmo critério de `property_id`
- `attribution`: toque atual autoritativo da Ads Intelligence (`current_touch`): `gclid`, `gbraid`, `wbraid` e UTMs. Não usa o `YNTELIGENCIA_ATTRIBUTION` legado quando o toque atual existe, mesmo que o toque atual esteja vazio
- `last_product`
- `return_url`: volta para a YNTELIGENCIA com `imovel` e `vid`, sem o token

`return_url` é contexto de navegação. Não é preferência do comprador. O Agent não é obrigado a gravá-la em `extras`.

Na primeira fala, usar o imóvel e a busca. Exemplo de conteúdo, não de implementação: reconhecer o Flórida, no Brooklin, com 3 dormitórios, e oferecer comparação ou explicação de preço, localização e condições.

Se já existir conversa do agente para o mesmo `visitor_id` e `session_id`, continuar essa conversa com o contexto novo. Se não existir, iniciar com o contexto.

### 4. Ads Intelligence

Depois de aplicar o contexto, o Agent envia `agent_opened` no servidor:

`POST ${YNTELIGENCIA_ADS_ORIGIN}/api/ads?action=event`

```json
{
  "product": "agente_yincorp",
  "event_name": "agent_opened",
  "visitor_id": "<o mesmo do handoff>",
  "session_id": "<o mesmo do handoff>",
  "gclid": "",
  "gbraid": "",
  "wbraid": "",
  "utm_source": "",
  "utm_medium": "",
  "utm_campaign": "",
  "utm_term": "",
  "utm_content": "",
  "declared_intent": {},
  "property": {}
}
```

Preencher atribuição e imóvel com o que veio no contexto. `property.property_id` continua sendo o `external_id`.

Falha nesse evento não bloqueia o bootstrap nem a conversa. `agent_opened` e `agent_handoff_created` não entram na exportação de conversão do Google Ads. `agent_handoff_created` é gravado pela YNTELIGENCIA; o agente não envia esse nome.

O schema, o `high_intent_buyer`, o current touch, a deduplicação e a separação first/current/observed continuam os do `docs/ads-identity-contract.md`. As actions já existentes permanecem: `event`, `feed`, `intent-feed`, `sheet` e `google-conversions`.

### 5. Especialista e lead

O agente não cria backend de lead. Quando a pessoa pedir atendimento humano, visita ou especialista, usar o contrato já existente:

`POST ${YNTELIGENCIA_ADS_ORIGIN}/api/lead`

Campos:

- `origem`: `ynteligencia_agente` (o prefixo `ynteligencia_` mantém o Praedium fora deste fluxo)
- `nome`, `telefone`, `email`
- `visitor_id`, `session_id`
- `property_id`, `property_name`, `neighborhood`, `property_value`, `bedrooms`, `inventory_source`
- `gclid`, `gbraid`, `wbraid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- `lead_summary`: resumo útil com bairro, dormitórios, imóvel e intenção. Sem transcrição crua se ela contiver dado pessoal além do necessário ao corretor.

`property_id` nesse lead também é o `external_id`.

WhatsApp, GA4, Google Ads e Meta só depois de `supabase === true`, como na YNTELIGENCIA. Em seguida:

`POST ${YNTELIGENCIA_ADS_ORIGIN}/api/ads?action=event` com `event_name: "lead_created"` e `product: "agente_yincorp"`, sem nome, telefone, e-mail ou resumo.

### 6. Volta para a YNTELIGENCIA

Abrir `context.return_url` quando a pessoa quiser voltar. A YNTELIGENCIA já aceita `imovel` e `vid`.

## Armazenamento

Tabela `ads_handoffs`, com RLS ligado e sem policy pública. O arquivo `supabase/ads_handoffs.sql` acompanha este PR e não é aplicado por ele. A tabela só entra no banco imediatamente antes de ligar `ADS_AGENT_HANDOFF_ENABLED`.

Banco que já aplicou `supabase/ads_events.sql` usa o arquivo incremental. Banco novo pode rodar o `ads_events.sql` atualizado, que inclui a tabela.

Colunas: `handoff_id`, `visitor_id`, `session_id`, `source_product`, `target_product`, `context`, `created_at`, `expires_at`, `consumed_at`.

A primeira leitura grava `consumed_at`. Leituras seguintes funcionam até `expires_at`.
