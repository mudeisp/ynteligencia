# Paid Click Experience V1

A entrada paga continua a intenção já declarada no anúncio. O usuário vê imóveis antes de qualquer pedido de retenção.

## Fluxo

`ADS → CLICK → RESULTADOS DIRETOS → VALOR PERCEBIDO → PUSH ASK → PERMISSÃO NATIVA → SUBSCRIPTION REAL → AUDIÊNCIA RETIDA`

URLs qualificadas com bairro/neighborhood, dormitórios/bedrooms, preços, tipo/type, região/region, busca/search ou empreendimento/development abrem resultados diretamente. `modo=explorar` continua pertencendo ao catálogo. UTMs e click IDs existentes são preservados pelo app e não são copiados para os novos eventos sanitizados deste módulo.

## Push e autoridade

O prompt próprio só fica elegível depois de valor percebido. `Notification.requestPermission()` não roda no page load; a permissão OneSignal é solicitada apenas após o clique em `SIM, QUERO SER AVISADO`.

Sucesso exige simultaneamente: permissão concedida, `PushSubscription.optedIn=true`, `subscriptionId` não vazio e configuração das tags do alerta concluída. Falha em qualquer etapa não mostra sucesso e não gera um segundo `push_subscribed`. O fluxo existente é a autoridade operacional e retorna um resultado explícito.

`localStorage` é cache auxiliar. Após inicialização do SDK, o estado visual é reconciliado com OneSignal; mudanças da PushSubscription também disparam reconciliação. SDK ainda indisponível é `unknown/pending`, nunca sucesso inventado.

Erro técnico após aceite é `subscription_unresolved` (estado J), não `dismiss`. `Agora não`, fechar e tocar fora são dismiss explícitos. Negativa nativa é um estado separado.

## Intenção do alerta

A paid intent normalizada é passada explicitamente ao fluxo de inscrição. Defaults vazios/zero da UI não sobrescrevem uma intenção paga válida. Quando o usuário refina explicitamente a busca, `adIntent` passa a representar a intenção atual e é essa intenção que configura o alerta.

A memória de “mesma busca” compara bairro, região, dormitórios, preço mínimo/máximo, tipo, busca e empreendimento quando presentes.

## Detalhe do imóvel

O prompt não fica visualmente sobre o `photoModal`. Se o detalhe abre com o prompt já ativo, a apresentação é ocultada; ao fechar, o estado é reavaliado sem gerar dismiss.

## Sanitização

Os novos eventos aceitam apenas campos simples previstos. E-mail, telefone, URL, strings excessivas, chaves de contato e raw `gclid`/`gbraid`/`wbraid` são removidos. Valores imobiliários válidos como `Perdizes`, `bedrooms=2` e `max_price=800000` continuam aceitos.

## Estados

A primeira visita começa em A; valor percebido leva a B; prompt C; aceite pendente D; subscription real E; dismiss explícito F; permission denied G; retorno já inscrito H; retorno não inscrito I; erro técnico/unresolved J.

## Fora do escopo

Não foram redesenhados nem alterados MATCH/pontuação, inventário, Órulo, usados, `/api/lead`, Praedium, Resend, Google Ads, Meta, captura de GCLID/GBRAID/WBRAID, PWA, manifest, service worker, IA, WhatsApp Agent ou M.I.A. Não há score nem classificação comercial neste bloco.
