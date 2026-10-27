# Portal público Yincorp — V3

Somente PR/Preview. O domínio canônico é https://www.yincorp.com.br. O app continua responsável pelas APIs, inventário, sincronização Órulo, tracking e leads. Nenhuma alteração de banco, integração, credencial, DNS ou produção.

## Dados auditados em 27/10/2026

566 registros ativos ES, 172 empreendimentos, 10 cidades; Vitória: 46 empreendimentos. Contagens são calculadas em tempo de consulta, nunca constantes na apresentação.

| Origem | Tipo real | Apresentação |
| --- | --- | --- |
| building.address | objeto | Endereço, CEP, mapa sob demanda quando coordenadas válidas |
| building.images / images | arrays de URLs HTTPS | Todas as fotos, mosaico inicial, miniaturas lazy e dialog com teclado |
| building.features / building_features / unit_features | arrays de objetos com name | Nomes deduplicados; três diferenciais nos cards |
| building.description, developer, finality, type, stage, status | strings | Texto escapado, descrição completa, ficha e status |
| building.stock, total_units | números; total_units ausente em parte dos registros | Somente valores conhecidos, zero preservado |
| building.number_of_floors, number_of_towers, apts_per_floor | números ou null | Ficha técnica, omissão de ausentes |
| building.launch_date, opening_date | strings DD/MM/YYYY ou null | Validação de calendário; entrega informada, sem inferir atraso ou conclusão |
| building.floor_plans | array de objetos | ID, tipo, descrição, associações; nenhuma URL no inventário auditado |
| typology.type, reference | strings | Identificação comercial em vez de Opção 1/2 |
| typology.stock, suites, parking, bedrooms, bathrooms, private_area | números | Configuração detalhada, estoque informado, intervalos de comparação |
| typology.original_price, discount_price | números | Preço operacional do registro; original riscado apenas se maior que o atual |
| typology.features | array | Diferenciais da configuração, quando existentes |

Os 5.597 objetos de planta associados às linhas auditadas só possuem id, type, description e associations. Não construir URL a partir de ID. Um URL HTTPS explícito futuro pode ser apresentado; os dados atuais mostram apenas as descrições.

building.developer_data e publisher não são exibidos: podem conter contato comercial. payment_conditions, files, vídeos e tours não são publicados indiscriminadamente. floor_area/total_area estavam nulos em todas as linhas; não inventar área de terreno. A leitura usa projeção explícita, sem raw_data completo.

## Experiência e SEO

Cards por empreendimento, área/quartos/vagas/suítes, status, entrega e diferenciais. Página individual com resumo comercial, galeria integral, descrição, ficha, lazer, plantas, configurações, mapa sob demanda e três projetos reais da cidade, priorizando bairro e proximidade de preço. Rótulos e preços vêm do catálogo.

Vitória possui editorial e contagens no HTML servido, inclusive sem JavaScript. Apenas bairros com estoque recebem links. Texto factual baseado na Prefeitura de Vitória: /turista/, /turista/patrimonio-historico-e-cultural e /semmam/praia-de-camburi. Foto de Camburi: Vilamir Azevedo, Wikimedia Commons, CC BY-SA 3.0; crédito e licença visíveis. Enquadramento adaptado por CSS.

Preservadas URLs estáveis por ID, canonical www, breadcrumbs, sitemap, paginação, 404/503, noindex em filtros/tipologias e no Preview. O cliente V2 deixa de ser importado: dados importantes deixam de depender de chamadas extras no navegador. Lead/session/tracking existentes preservados; Preview não envia nem registra eventos.

## Validação

node --test portal.test.mjs portal-v3.test.mjs: 27 testes. O teste antigo de sitemap passou a verificar os URLs loc, porque o prólogo XML legítimo contém ?. Testes novos cobrem ausência/zero, datas brasileiras, escaping, 31 fotos, plantas sem URL, preço original, editorial SSR, relacionados e projeção pública.

Navegador desktop 1440px e celular 390px: sem erros JS ou overflow; galeria abre, avança e fecha com Escape; formulário informa bloqueio em Preview; nenhum POST. Consulta REST real validou campos e paginação. Não houve envio de lead real. Core Web Vitals reais dependem de medição de campo após eventual publicação; não são inferidos de testes locais.
