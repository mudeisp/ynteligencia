# Portal Yincorp — infraestrutura São Paulo

Esta branch prepara `/sp` para usar o mesmo portal SSR e o mesmo sistema editorial modular aprovado em `/es`, sem criar um segundo produto e sem alterar a sincronização de inventário.

## Hierarquia

- `/sp`
- `/sp/sao-paulo`
- `/sp/sao-paulo/<bairro>`
- `/sp/sao-paulo/empreendimento/<slug>--orulo-<id>`
- `/sp/sao-paulo/empreendimento/<slug>--orulo-<id>/tipologia/<uuid>`

A infraestrutura continua genérica para outras cidades do estado que tenham estoque editorial real.

## Escala e camada de leitura

O inventário ativo de SP é muito maior que o ES. Ler `raw_data` completo de milhares de tipologias em cada acesso SSR não escala.

A solução mantém `public.properties` como fonte de verdade, mas separa duas leituras:

1. **listagem/SEO**: RPC `public.portal_inventory_listing_v1(state)`, uma projeção compacta dos campos necessários para cards, geografia, filtros, canonical e ItemList;
2. **LP do empreendimento**: somente depois que um projeto é aberto, o portal busca as linhas completas daquele `building_id`/conjunto de IDs, preservando fotos, plantas, vídeos, amenidades e ficha técnica.

A função é `stable`, `security invoker`, fixa `search_path = public, pg_temp` e só pode ser executada por `service_role`. `public`, `anon` e `authenticated` não recebem `EXECUTE`.

O leitor antigo permanece como fallback de compatibilidade, com timeout por página e paginação paralela limitada.

## Escopo editorial do catálogo

A tabela `properties` mistura produtos diferentes em SP.

No recorte auditado em 28/10/2026:

- SP tinha 10.736 linhas ativas no total;
- `source = novos`: 7.487 linhas / 3.543 `building_id` distintos;
- `source = usados`: 3.249 linhas sem `building_id`.

Além disso, dentro de `source = novos`, SP continha 1.445 projetos cujo `building.status` e `building.stage` eram `Usado`.

Para não transformar imóveis individuais/reatendidos em LPs de empreendimento, o índice editorial de SP exclui esses registros `Usado`. O app continua sendo o produto para exploração de usados.

Resultado do índice editorial SP:

- **6.042 linhas de tipologias**;
- **2.098 empreendimentos**;
- **40 cidades**.

O ES é preservado integralmente, sem mudar a regra já aprovada:

- **566 linhas**;
- **172 empreendimentos**;
- **10 cidades**.

## Direção editorial

A linguagem visual das páginas de empreendimento é a mesma aprovada no sistema modular.

Na home estadual de São Paulo há uma diferença deliberada: quando a cidade de São Paulo existe no estoque, a descoberta principal é por **bairro**, não por cidade. Os bairros são derivados do inventário e ordenados pela quantidade de empreendimentos. Nenhum bairro é inventado ou hardcoded para aparecer na coleção principal.

A home usa como imagem principal material real de um empreendimento do próprio estoque de SP. Não reutiliza a fotografia editorial de Vitória.

## Navegação

Header e footer respeitam `data.state`:

- páginas ES continuam voltando para `/es`;
- páginas SP voltam para `/sp`;
- texto e catálogo do footer seguem o estado;
- LPs de SP não herdam navegação de Espírito Santo;
- placeholder de WhatsApp usa DDD 11 em SP e mantém DDD 27 no ES.

## SEO

As regras existentes são preservadas:

- canonical `www.yincorp.com.br`;
- BreadcrumbList;
- ItemList nas listagens;
- schema semântico das LPs;
- filtros com `noindex`;
- Preview com `noindex`;
- rotas canônicas por estado/cidade/bairro/projeto.

O sitemap passa a considerar `ES,SP` por padrão e usa o mesmo índice leve. Estados sem estoque não geram URLs.

## Testes adicionados

`sp-portal.test.mjs` cobre:

1. parse de `/sp`, `/sp/sao-paulo` e bairro;
2. home SP orientada a bairros;
3. ausência de chrome/texto herdado do ES;
4. canonical de bairro;
5. link real de empreendimento;
6. LP modular em SP;
7. placeholder de telefone compatível com SP;
8. sitemap conjunto ES + SP.

## Preview validado

A infraestrutura passou de 503 por volume de catálogo para HTTP 200 após a separação do índice leve.

Antes de merge/Production, a rodada final deve validar:

- `/sp` com o recorte editorial de 2.098 projetos;
- `/sp/sao-paulo`;
- Pinheiros, Vila Mariana, Moema, Perdizes, Campo Belo e Brooklin Paulista;
- pelo menos um studio, um produto de ticket mais baixo, um produto intermediário, um alto padrão e um caso com pouco material visual;
- uma LP real de SP com dados completos;
- regressão `/es` preservando 172 empreendimentos;
- sitemap, canonical, schema, tracking e lead.

Esta branch não deve ser mergeada nem promovida para Production antes dessa validação final.
