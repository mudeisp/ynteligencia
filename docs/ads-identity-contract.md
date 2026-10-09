# Contrato de identidade entre YNTELIGENCIA e agente-yincorp

Os dois produtos usam o mesmo endpoint e o mesmo schema.

`POST /api/ads?action=event`

A diferença entre os produtos é somente o campo `product`:

- `ynteligencia`
- `agente_yincorp`

Não existem rotas separadas por produto.

## visitor_id

- É um UUID. Não contém nome, telefone, e-mail nem outro dado pessoal.
- Não entra em `/api/ads?action=feed`, `/api/ads?action=intent-feed` nem `/api/ads?action=google-conversions`.
- Pode ir na navegação entre os produtos da Yincorp.

Quando um produto enviar o comprador ao outro sem contexto de imóvel, a URL pode levar só o identificador:

`https://agente.example/?vid=<visitor_id>`

O contexto de um imóvel aberto na YNTELIGENCIA não vai na query string. Esse caminho está em `docs/agent-handoff-contract.md`. Ele só abre `https://agente.yincorp.com.br/?handoff=<token>` quando `ADS_AGENT_HANDOFF_ENABLED` vale `true` no servidor. Ausente, a flag fica desligada e a Match IA da ficha permanece.

O produto de destino deve:

1. Ler `vid`.
2. Aceitar somente UUID. `acceptVisitorId(vid, idLocal)` devolve o `vid` quando ele é válido.
3. Se `vid` for inválido ou ausente, manter ou gerar o `visitor_id` local. Não reaproveitar lixo da URL.
4. Persistir o valor aceito.
5. Enviar esse mesmo `visitor_id` em todos os `POST /api/ads?action=event`.

`session_id` continua sendo a visita, não a pessoa. Uma sessão nova não apaga `first_declared_intent`, `first_gclid` nem a primeira origem.

## First touch e last touch

No primeiro evento do `visitor_id`, o backend grava a origem e não a substitui.

Em uma visita posterior:

- `first_gclid`, `first_utm_source`, `first_utm_campaign` e `first_product` permanecem.
- `last_seen` e `last_product` acompanham o evento novo.
- Um `ad_entry` sem `gclid`, `gbraid`, `wbraid` e sem `utm_source` marca `last_utm_source` como `organic`.
- O clique original não é apagado só porque o retorno não trouxe outro clique.

## Intenção

O cliente envia a busca explícita em `intent` ou no alias `declared_intent`.

O backend separa:

- `first_declared_intent`: primeira busca explícita válida. Não é substituída.
- `current_declared_intent`: busca explícita válida mais recente.
- `observed_intent`: calculada só pelo comportamento no servidor.

Busca explícita válida é `ai_search` ou `ad_entry` com bairro, empreendimento, dormitórios ou preço. Ver imóvel, abrir a IA, CTA ou lead não mudam a intenção declarada. O cliente não define `observed_intent` nem envia `high_intent_buyer`.

## Payload que o agente deve enviar

`POST /api/ads?action=event`

```json
{
  "product": "agente_yincorp",
  "event_name": "property_view",
  "visitor_id": "11111111-1111-4111-8111-111111111111",
  "session_id": "sessao-do-agente",
  "gclid": "",
  "gbraid": "",
  "wbraid": "",
  "utm_source": "",
  "utm_medium": "",
  "utm_campaign": "",
  "utm_term": "",
  "utm_content": "",
  "declared_intent": {
    "neighborhood": "Perdizes",
    "development": "",
    "bedrooms": 2,
    "min_price": 0,
    "max_price": 900000,
    "inventory_source": ""
  },
  "property": {
    "property_id": "nonstop:XYZ",
    "name": "Ed. Exemplo",
    "neighborhood": "Perdizes",
    "development": "",
    "bedrooms": 2,
    "price": 850000,
    "inventory_source": "usados"
  }
}
```

Eventos aceitos do cliente: `ad_entry`, `ai_search`, `property_view`, `property_view_multiple`, `specialist_cta_opened`, `lead_created`.

`high_intent_buyer` é derivado no backend. Não enviar nome, telefone, e-mail, resumo ou transcrição.
