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

`public.properties` continua sendo a fonte de verdade. O portal separa duas leituras:

1. **listagem/SEO**: `public.portal_development_index`, view `security_invoker` com uma linha por empreendimento e um `unit_facets` compacto com os campos necessários para manter filtros de preço/dormitórios exatos;
2. **LP do empreendimento**: somente depois que um projeto é aberto, o portal busca as linhas completas das tipologias daquele empreendimento, preservando fotos, plantas, vídeos, amenidades e ficha técnica.

A view não expõe `raw_data`, contatos ou PII. Ela contém apenas dados já públicos de catálogo. O `www` usa a chave publicável/anon já existente; por isso a view recebe `SELECT` para `anon`, enquanto o RLS da tabela `properties` continua valendo por `security_invoker`.

O índice compacto é reidratado em unidades leves no servidor para que a lógica existente de faixa de área, preço, dormitórios, vagas, semântica e filtros continue igual. A LP continua usando os dados completos do projeto, não o resumo.

## Escopo editorial do catálogo

A tabela `properties` mistura produtos diferentes em SP.

No recorte auditado em 28/10/2026:

- SP tinha 10.736 linhas ativas no total;
- `source = novos`: 7.487 linhas / 3.543 `building_id` distintos;
- `source = usados`: 3.249 linhas sem `building_id`.

Dentro de `source = novos`, SP também continha 1.445 projetos cujo `building.status` e `building.stage` eram `Usado`.

Para não transformar imóveis usados em LPs de empreendimento, o índice editorial de SP exclui esses registros `Usado`. O app continua sendo o produto para exploração de usados.

Resultado do índice editorial SP:

- **2.098 linhas de empreendimentos** no índice;
- **6.042 facets de tipologia** dentro dessas linhas;
- **40 cidades**.

O ES é preservado integralmente, sem mudar a regra já aprovada:

- **172 linhas de empreendimentos** no índice;
- **566 facets de tipologia**;
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

## Integração www

O adaptador `yincorp-landing/api/portal.js` precisa encaminhar o segundo argumento de `inventory(state, options)` para o núcleo. Isso permite distinguir `mode: listing` de `mode: project` e evita que o landing caia no leitor legado de estado completo.

O adaptador também repassa `method`, `body`, `Prefer` e `Content-Range` para o cliente PostgREST quando necessário.

## SEO

As regras existentes são preservadas:

- canonical `www.yincorp.com.br`;
- BreadcrumbList;
- ItemList nas listagens;
- schema semântico das LPs;
- filtros com `noindex`;
- Preview com `noindex`;
- rotas canônicas por estado/cidade/bairro/projeto.

O sitemap passa a considerar `ES,SP` por padrão e usa o mesmo índice compacto. Estados sem estoque não geram URLs.

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

## Validação antes de merge

Antes de merge/Production, validar no mesmo Preview:

- `/sp` com **2.098 empreendimentos**;
- `/sp/sao-paulo`;
- Pinheiros, Vila Mariana, Moema, Perdizes, Campo Belo e Brooklin Paulista;
- pelo menos um studio, um produto de ticket mais baixo, um produto intermediário, um alto padrão e um caso com pouco material visual;
- uma LP real de SP com dados completos;
- regressão `/es` preservando **172 empreendimentos**;
- sitemap, canonical, schema e formulário em Preview sem envio/tracking.

Esta branch não deve ser mergeada nem promovida para Production antes dessa validação final.
