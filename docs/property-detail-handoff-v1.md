# CTA manual da ficha -> property handoff v1

## Escopo

Somente os dois controles já ligados a `openAgentConversation(p)` no detalhe do imóvel: “Conversar com a IA” e “I.A ajuda”. Labels, DOM, destino `https://agente.yincorp.com.br/` e os dois listeners permanecem iguais. Home, empreendimento, catálogo, MATCH, IA proativa, Push e atendimento humano conservam seus handlers. Nenhuma função local de IA foi removida.

## Transporte e compatibilidade

`agent-property-handoff.js` é um módulo puro compartilhado entre browser e servidor. Constrói e revalida exclusivamente:

```
{version:1,kind:"property",entryPoint:"property.detail.manual_ai",
 visitorId,sessionId,transitionId,returnUrl,
 context:{currentProperty:{external_id,db_id,inventory_source,source,
 name,neighborhood,city,bedrooms,price}},paidContext?}
```

`transitionId` usa um UUID seguro novo por abertura aceita. Sem identidade válida, referência real ou suporte a UUID seguro, abre a IA local. IDs comerciais e UUID da linha são campos separados; o UUID não vira `external_id`. Dados opcionais pessoais/URLs são omitidos, sem copiar objetos arbitrários do imóvel.

Quando `yntHasPaidClickContext()` identifica contexto pago (inclusive URL live), o adicional é somente `{isPaid:true,intent:null}`. Não inferimos preferências com base no anúncio. Sem contexto pago, o campo é omitido. Click IDs, first/current touch, contato, URL de chegada e transcript não entram no contexto conversacional.

O POST continua em `/api/ads?action=create-handoff`. O envelope é a raiz; o campo separado `tracking` leva a projeção de atribuição atual e a intenção/development já usados pelo caminho anterior. `yntAdsAttribution()` continua lendo o toque persistido original; o sinal pago live não o reescreve.

`agent-handoff-v1.js` adapta esse transporte ao `ads.createHandoff` existente. O único acréscimo persistido é `context.property_handoff_v1` na linha já existente em `ads_handoffs`. Nenhuma migration, tabela ou function nova. O núcleo `ads-intelligence.js`, a resolução de clique/conversão, TTL de 15 minutos, gravação de `agent_handoff_created`, deduplicação e RPCs permanecem iguais. Um teste compara os eventos nativo/legado integralmente.

No `get-handoff`, o adaptador valida o envelope armazenado e sua correspondência com visitor/session da linha. Retorna `{success:true,...envelope}` na raiz para o parser nativo do AGENTE, sem entregar atribuição/conversão ao contexto nativo. Um registro nativo inválido falha fechado; não é rebaixado a legado. Tokens/linhas antigos conservam a resposta legada. O CORS, flag server-side, no-store e mecanismo de token continuam os mesmos.

Nenhum evento novo no browser. O produtor não fabrica `agent_opened`; o bootstrap nativo do AGENTE define seu próprio comportamento de runtime. `agent_handoff_created` continua exclusivamente no caminho existente de criação.

## Navegação e fallback

A volta é construída do zero com a rota existente `/?imovel=<id>&vid=<visitor>`, usando origem de produção allowlisted. Nenhuma query/fragmento da URL de entrada é copiado. De Preview, a origem de retorno é `https://app.yincorp.com.br`, pois o contrato atual do AGENTE não permite hosts arbitrários de Preview. Se o ID comercial não tiver formato de deep link aceito, retorna à raiz segura do catálogo, sem inventar rota.

Preservamos `yntOpenAgentOnce`: abre uma janela em branco com opener removido e navega por link `noopener noreferrer`; quando popup é bloqueado, usa a mesma aba uma única vez. Erro ao usar a janela fecha a janela vazia e abre a IA local. Nenhum timer redireciona.

O guard de requisição em voo e a janela de 750 ms por tentativa impedem o duplo clique, inclusive quando a primeira resposta é imediata. Nova abertura legítima depois dessa janela recebe novo UUID. O fetch tem timeout de oito segundos quando `AbortSignal.timeout` está disponível; erro/abort, flag desligada, `handoff_disabled`, JSON inválido, status de erro, ausência de token ou URL de destino inválida acionam `openAiAssistant(p)`.

## Validação local

- `node --test agent-property-handoff.test.js`: 25 testes novos, incluindo DOM/listeners, UUID/IDs, paid live sem sobrescrita, fallback, popup/duplo clique, adaptador e roteador real com REST simulado.
- `node --test --test-name-pattern="handoff|popup|flag desligada|null de noopener|falha ao usar|YNTELIGENCIA reutiliza" ads-intelligence.test.js`: 12 testes existentes relevantes.
- Suíte sem PostgreSQL local: todos os arquivos `.test.js` exceto `buyer-profile.test.js` e `inventory-summary-postgres.test.js`, com `--test-skip-pattern '^(o claim reserva|a identidade do lead é atômica|o Postgres repete)'`: 231 aprovados.
- `node --test`: 232 aprovados / 35 falhas. As mesmas 35 falhas já ocorrem no main antes do patch, por `spawnSync psql ENOENT`. Nenhum teste foi marcado skip nem alterado para esconder a limitação.
- Sintaxe: 44 arquivos JS com `node --check` e 10 scripts inline compilados com `vm.Script`.
- Comparação local: todo o HTML fora do bloco do launcher e do novo script tag permanece byte a byte igual ao main.
- Compatibilidade adicional fora da suíte: os quatro casos externo+DB/DB-only x pago/orgânico passaram diretamente no `parseContextHandoff` do main do AGENTE `6b546b0a2eee675d340be34e8ec0d573b31304b8`.

O repositório não possui package.json, lint, typecheck ou build script; nenhuma dependência/lockfile foi adicionada. Os testes de rede/store são determinísticos e não comprovam acesso a um banco real, deployment ou E2E em navegador.

## Validação integrada em Preview, antes do merge

Nenhum deploy ou alteração de ambiente foi executado por este PR. Usar Previews já preparados pela equipe/CI:

1. Ynteligencia Preview no projeto correto `ynteligencia`, com esta branch, banco de teste contendo as tabelas/RPCs atuais e um imóvel real de teste de cada estoque. Para o caso ligado, `ADS_AGENT_HANDOFF_ENABLED=true` somente no ambiente Preview. Manter também um Preview com a flag desligada. Não usar `ynteligencia-app` como Production.
2. AGENTE Preview com o runtime de foco já integrado e `YNTELIGENCIA_ADS_ORIGIN=https://<ynteligencia-preview>`, apontando para o mesmo banco de teste aplicável à jornada. Confirmar acesso/autenticação aos dois Previews antes do teste. Não assumir que a versão atualmente em Production já corresponde ao main.
3. O destino entregue pelo produtor permanece canônico. Para testar entre dois Previews sem alterar esse contrato, usar um contexto de QA do Playwright (instalado fora deste projeto) com estas interceptações **somente de navegação no browser de teste**, antes de abrir a ficha:

```js
for (const [canonical, preview] of [
  ["https://agente.yincorp.com.br", AGENT_PREVIEW],
  ["https://app.yincorp.com.br", YNT_PREVIEW]
]) {
  await context.route(canonical + "/**", async route => {
    if (!route.request().isNavigationRequest()) return route.continue();
    const original = new URL(route.request().url());
    const destination = new URL(original.pathname + original.search, preview);
    await route.fulfill({status:302, headers:{location:destination.toString(),
      "cache-control":"no-store"}, body:""});
  });
}
const page = await context.newPage();
await page.goto(YNT_PREVIEW + "/?imovel=" + encodeURIComponent(EXTERNAL_ID));
```

Essas interceptações pertencem apenas ao harness de QA, não ao produto. Elas impedem que a navegação principal de AGENTE/retorno atinja Production e preservam o token transitório para o backend do Preview. Não imprimir/persistir o token em logs ou relatórios.

4. Clicar em “Conversar com a IA”; repetir em uma nova abertura com “I.A ajuda”. Conferir no Network: um POST de criação, raiz `version:1/kind:property`, IDs separados e UUID novo entre aberturas. Dar duplo clique em um controle e confirmar apenas um POST/uma navegação. No AGENTE Preview, conferir bootstrap/foco e perguntar preço e localização. Recarregar e confirmar o mesmo foco.
5. Abrir uma ficha no Preview com `?imovel=<id>&gclid=<valor-de-teste>` e outra com `utm_medium=cpc`. Conferir `paidContext={isPaid:true,intent:null}`, ausência desses parâmetros no contexto e no retorno e preservação do toque original no tracking. `utm_medium=email` sem outro sinal pago não deve incluir paidContext. Em banco de teste, conferir um único `agent_handoff_created` e ausência de `agent_opened` fabricado pelo produtor.
6. Acionar a volta do AGENTE: o `returnUrl` armazenado deve ser a URL canônica segura com `imovel/vid` e sem token; o harness deve abrir a mesma ficha no Ynteligencia Preview. Testar popup bloqueado: a aba atual deve chegar ao AGENTE Preview uma única vez.
7. No Preview desligado, ambos os controles devem abrir a IA local sem navegar ao AGENTE. No harness, simular falha/timeout/500/JSON sem token no `create-handoff` e confirmar o mesmo fallback. Verificar que home, empreendimento, MATCH, catálogo e IA proativa continuam locais e que o CTA humano e Push conservam as ações anteriores.

Sem as etapas integradas acima e o banco local para os checks PostgreSQL, não afirmar paridade E2E ou autorização para merge/deploy.
