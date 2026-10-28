# Portal Yincorp — infraestrutura São Paulo

Esta branch prepara `/sp` para usar o mesmo portal SSR e o mesmo sistema editorial modular aprovado em `/es`, sem criar um segundo produto, sem novo banco e sem alterar o inventário.

## Hierarquia

- `/sp`
- `/sp/sao-paulo`
- `/sp/sao-paulo/<bairro>`
- `/sp/sao-paulo/empreendimento/<slug>--orulo-<id>`
- `/sp/sao-paulo/empreendimento/<slug>--orulo-<id>/tipologia/<uuid>`

A infraestrutura continua genérica para outras cidades do estado que tenham estoque real.

## Dados

`readInventory('SP')` usa a mesma tabela `properties`, o mesmo `SELECT`, agrupamento por `building_id` e as mesmas regras de semântica, fotos, plantas, vídeos, preço e disponibilidade do Espírito Santo.

Nenhuma carga, webhook, schema ou credencial nova foi criada.

## Direção editorial

A linguagem visual das páginas de empreendimento é a mesma aprovada no sistema modular.

Na home estadual de São Paulo há uma diferença deliberada: quando a cidade de São Paulo existe no estoque, a descoberta principal é por **bairro**, não por cidade. Os bairros são derivados do inventário e ordenados pela quantidade de empreendimentos. Nenhum bairro é inventado ou hardcoded para aparecer na coleção principal.

A home usa como imagem principal material real de um empreendimento do próprio estoque de SP. Não reutiliza a fotografia editorial de Vitória.

## Navegação

Header e footer passam a respeitar `data.state`:

- páginas ES continuam voltando para `/es`;
- páginas SP voltam para `/sp`;
- texto e catálogo do footer seguem o estado;
- LPs de SP não herdam navegação de Espírito Santo.

## SEO

As regras existentes são preservadas:

- canonical `www.yincorp.com.br`;
- BreadcrumbList;
- ItemList nas listagens;
- schema semântico das LPs;
- filtros com `noindex`;
- Preview com `noindex`;
- rotas canônicas por estado/cidade/bairro/projeto.

O sitemap passa a considerar `ES,SP` por padrão. Estados sem estoque não geram URLs porque o XML é montado a partir dos grupos efetivamente retornados.

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

## Release

Esta etapa é apenas infraestrutura de código. Enquanto a Vercel estiver com limite de deployments atingido, não há Preview novo nem promoção para Production.

Antes de publicar `/sp`, validar com inventário real:

- quantidade de empreendimentos SP;
- cidades e bairros;
- páginas `/sp`, `/sp/sao-paulo` e bairros prioritários;
- pelo menos um studio, um produto de ticket mais baixo, um produto intermediário, um alto padrão e um caso com pouco material visual;
- canonical, sitemap, schema, tracking e lead em ambiente Production.
