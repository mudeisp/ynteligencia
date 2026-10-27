# British Contemporary — composição editorial

Branch dedicada: codex/british-editorial-core, baseada na V3 mais recente (8691f34). www: codex/british-editorial-www, baseada na integração mais recente (cbdfd0f). Escopo exclusivo de apresentação e Preview. Nenhum merge, promoção, DNS ou mudança no banco.

## Mudança estrutural

O HTML SSR foi recomposto, em vez de receber outra camada de CSS. portal/editorial.js define composições distintas para estado, cidade e empreendimento; render.js continua responsável pelos metadados, breadcrumbs, schema, configuração pública e formulário existente. Uma única folha portal-editorial.css substitui as folhas antigas na página, sem cascata de temas.

Estado: hero fotográfico amplo, título editorial sobreposto, busca integrada, métricas do inventário, cidades em composição escalonada, catálogo aberto e ensaio sobre viver no Espírito Santo. Cidade: abertura assimétrica com título e fotografia, bairros com estoque real e catálogo. Vitória preserva editorial SSR factual.

Empreendimento: nome, preço e atendimento integrados à abertura; imagem ampla; dados em filete; descrição; ensaio fotográfico horizontal; plantas em escala grande, com legenda externa e ampliação; configurações; diferenciais; ficha técnica aberta; mídia; localização; atendimento e relacionados. O Youniverse Studios é a página de validação.

Marca: wordmark yincorp de fato no HTML, sem monograma oculto por CSS. Serif Cormorant Garamond em marca, títulos e números; Inter em interface. Ivory, navy quase preto, stone e bronze discreto. Componentes retos, sem contêineres de card. Menu, hero, busca e página de empreendimento têm organização específica para celular. Fotos e plantas usam rolagem manual com teclado, botões, swipe e preferência por movimento reduzido; modais nativos devolvem o foco ao controle de origem.

## Preservação

Não foram alterados model.js, details.js, inventory.js, APIs de lead, sincronização Órulo ou banco. portal.js, portal-contact.js, portal-session.js e analytics.js são preservados byte a byte. O formulário, os IDs de unidade e o JSON público mantêm o contrato. visitor_id, session_id, GCLID, UTMs e eventos continuam sob os adaptadores existentes.

URLs e tokens de empreendimento, filtros conjuntos, canonical www, breadcrumbs, sitemap, schema, paginação, noindex no Preview e tratamento de erros permanecem. O router apenas entrega os grupos já lidos à apresentação para métricas e fotos por cidade, sem outra consulta ou cópia de inventário.

## Dados e imagens

Consulta atual: 566 registros, 172 empreendimentos, 10 cidades, 3.697 unidades com estoque informado (soma dos estoques das configurações). Os números da interface são calculados, incluindo o escopo de cidade/bairro. Não usar 3.950 como constante.

O inventário agora contém URLs públicas reais para as 27 plantas do Youniverse Studios. Elas são aproveitadas sem alterar integração, importar novamente ou inferir URLs por ID. Ausência de imagem em outros projetos continua tratada por descrição. Imagens e descrições permanecem escapadas e os URLs são normalizados pelo modelo existente.

Foto de Camburi: Vilamir Azevedo, Wikimedia Commons, CC BY-SA 3.0, enquadramento por CSS. Créditos e licença visíveis. Fotos de projetos e cidades (quando representadas por um empreendimento) têm legenda que identifica o conteúdo real. Não são inventadas fotografias de cidades. Textos factuais de Vitória mantêm as fontes da Prefeitura.

## Verificação

Testes existentes e novos: portal.test.mjs, portal-v3.test.mjs, portal-editorial.test.mjs. A asserção do H1 da cidade foi atualizada para o novo título; metadados e URL continuam verificados. No ponto de partida, 26/27 testes passavam por uma asserção antiga de galeria; o botão Ver todas as fotos volta à abertura nesta composição.

Navegador em 1440px e 390px nas rotas /es, /es/vitoria e /es/vitoria/empreendimento/youniverse-studios--orulo-66878. Verificados H1 único, ausência de overflow, 27 plantas reais, modal, teclado, Escape e formulário bloqueado na prévia. Nenhum POST real ou evento de conversão para teste. Não se presume melhoria de conversão sem medição posterior.
