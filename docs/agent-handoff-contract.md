# Contrato de handoff entre YNTELIGENCIA e AGENTE.YINCORP

A YNTELIGENCIA continua a descoberta de imóveis. O AGENTE.YINCORP continua o projeto conversacional, na URL `https://agente.yincorp.com.br/`. Este repositório não contém o código do agente e não o incorpora.

O handoff transporta contexto sem PII e sem aumentar o número de Serverless Functions. Tudo passa por `/api/ads`.

## O que a YNTELIGENCIA já faz

Na ficha do imóvel:

- **Conversar com a IA** e **I.A ajuda** pedem `POST /api/ads?action=create-handoff` e abrem a URL devolvida em uma nova aba.
- **Falar com especialista** continua em `openPropertySpecialist` → `openLeadCapture` → `/api/lead`.
- A Match IA da home permanece no próprio app.

A URL aberta tem somente um parâmetro:

`https://agente.yincorp.com.br/?handoff=<token>`

O token tem 32 bytes aleatórios, codificados em base64url (43 caracteres). Vale 15 minutos. Não é o `visitor_id` e não carrega nome, telefone, e-mail, resumo nem transcrição.

## O que o AGENTE.YINCORP precisa implementar

### 1. Ler o token só da própria URL

Ao carregar `?handoff=`, o agente envia o token no corpo, nunca na query da YNTELIGENCIA:

`POST /api/ads?action=get-handoff`

```json
{ "handoff_id": "<token>" }
```

Origem permitida: `https://agente.yincorp.com.br`.

Respostas:

| HTTP | `error` | O que o agente faz |
|---|---|---|
| 200 | — | Usa `visitor_id`, `session_id` e `context` |
| 400 ou 404 | `handoff_invalid` | Abre a conversa normal, sem contexto |
| 410 | `handoff_expired` | Abre a conversa normal, sem contexto |

Nenhum desses casos pode quebrar a entrada direta, que continua sem `handoff`.

O corpo de sucesso não repete o token. Não grave o token em log, analytics ou prompt persistido.

### 2. Identidade

Com handoff válido:

- usar `visitor_id` recebido. Não gerar outro.
- usar `session_id` recebido enquanto a transição fizer parte da mesma jornada.
- persistir o `visitor_id` como a identidade local do agente.
- não ler `?vid=` nesta URL. O identificador vem do JSON.

Sem handoff, vale a lógica local já existente do agente.

### 3. Contexto

`context` traz:

- `current_property`: `property_id`, `name`, `neighborhood`, `development`, `bedrooms`, `price`, `inventory_source`
- `declared_intent`: busca que estava na tela
- `first_declared_intent`: primeira busca gravada, quando existir
- `current_declared_intent`: busca gravada mais recente, quando existir
- `observed_intent`: calculada no servidor, quando existir. O cliente não define esse campo.
- `recent_properties`: até 8 imóveis vistos
- `attribution`: `gclid`, `gbraid`, `wbraid` e UTMs
- `last_product`
- `return_url`: volta para a YNTELIGENCIA com `imovel` e `vid`, sem o token

Na primeira fala, usar o imóvel e a busca. Exemplo de conteúdo, não de implementação: reconhecer o Flórida, no Brooklin, com 3 dormitórios, e oferecer comparação ou explicação de preço, localização e condições.

Se já existir conversa do agente para o mesmo `visitor_id` e `session_id`, continuar essa conversa com o contexto novo. Se não existir, iniciar com o contexto.

### 4. Ads Intelligence

Depois de aplicar o contexto, enviar:

`POST /api/ads?action=event`

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

Preencher atribuição e imóvel com o que veio no contexto. `agent_opened` e `agent_handoff_created` não entram na exportação de conversão do Google Ads. `agent_handoff_created` é gravado pela YNTELIGENCIA; o agente não envia esse nome.

O schema, o `high_intent_buyer` e a separação first/current/observed continuam os do `docs/ads-identity-contract.md`.

### 5. Especialista e lead

O agente não cria backend de lead. Quando a pessoa pedir atendimento humano, visita ou especialista, usar o contrato já existente:

`POST /api/lead`

Campos:

- `origem`: `ynteligencia_agente` (o prefixo `ynteligencia_` mantém o Praedium fora deste fluxo)
- `nome`, `telefone`, `email`
- `visitor_id`, `session_id`
- `property_id`, `property_name`, `neighborhood`, `property_value`, `bedrooms`, `inventory_source`
- `gclid`, `gbraid`, `wbraid`, `utm_source`, `utm_medium`, `utm_campaign`, `utm_term`, `utm_content`
- `lead_summary`: resumo útil com bairro, dormitórios, imóvel e intenção. Sem transcrição crua se ela contiver dado pessoal além do necessário ao corretor.

WhatsApp, GA4, Google Ads e Meta só depois de `supabase === true`, como na YNTELIGENCIA. Em seguida:

`POST /api/ads?action=event` com `event_name: "lead_created"` e `product: "agente_yincorp"`, sem nome, telefone, e-mail ou resumo.

### 6. Volta para a YNTELIGENCIA

Abrir `context.return_url`. A YNTELIGENCIA já aceita `imovel` e `vid`.

## Armazenamento

Tabela `ads_handoffs`, com RLS ligado e sem policy pública. Banco que já aplicou `supabase/ads_events.sql` precisa rodar `supabase/ads_handoffs.sql`. Banco novo pode rodar o `ads_events.sql` atualizado, que inclui a tabela.

Colunas: `handoff_id`, `visitor_id`, `session_id`, `source_product`, `target_product`, `context`, `created_at`, `expires_at`, `consumed_at`.

A primeira leitura grava `consumed_at`. Leituras seguintes funcionam até `expires_at`.
