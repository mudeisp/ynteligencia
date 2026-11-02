# Yincorp — ciclo SEO e GEO de 90 dias

Início: 2 de novembro de 2026. Fechamento proposto: 30 de janeiro de 2027.

## Objetivo e escopo

Melhorar descoberta, informação para decisão e geração de leads qualificados em Vitória/ES e nos bairros Brooklin Paulista, Campo Belo, Moema e Itaim Bibi, na capital de SP. Consolidar páginas existentes antes de criar páginas por tipologia, orçamento e intenção.

Este é um calendário de execução e revisão. Não representa uma automação recorrente nem promessa de posição, tráfego, citação ou venda.

## Linha de base observada em 02/11/2026

| Página | HTTP | Empreendimentos no catálogo | Observação inicial |
|---|---:|---:|---|
| /es/vitoria | 200 | 46 | Indexável, canonical próprio, inventário SSR |
| /es/vitoria/investimento-airbnb | 200 | 6 selecionados | Landing publicada, seleção para investigação, sem autorização presumida |
| /sp/sao-paulo/brooklin-paulista | 200 | 34 | Página existente, abertura genérica |
| /sp/sao-paulo/campo-belo | 200 | 30 | Página existente, abertura genérica |
| /sp/sao-paulo/moema | 200 | 73 | Página existente, abertura genérica |
| /sp/sao-paulo/itaim-bibi | 200 | 40 | Página existente, abertura genérica |
| /sp/sao-paulo/brooklin | 404 | — | Nome abreviado sem encaminhamento |

Contagens extraídas do HTML público/ItemList nesta data; variam com o inventário. Não são estoque de unidades, demanda, volume de busca ou tamanho do mercado. O catálogo SP completo tinha 2.110 empreendimentos e a home combinava destaque de bairros da capital com listagem de outras cidades do estado.

As páginas prioritárias retornaram canonical www e index,follow; isso comprova elegibilidade técnica observada, não indexação efetiva no Google. robots.txt permite rastreamento público, bloqueia /api/ e referencia os sitemaps estático e dinâmico. A auditoria acessou as URLs públicas, não as rotas internas de API bloqueadas.

## Medição e acesso

O usuário confirmou Search Console e GA4 configurados e corrigiu que Bing Webmaster Tools ainda não está configurado. Não houve leitura autenticada dos relatórios de Search Console ou GA4 nesta execução. Não registrar tráfego, cliques, leads ou citações ausentes como zero.

| Indicador | Fonte | Recorte e regra |
|---|---|---|
| Indexação efetiva | Inspeção de URL/Search Console | Conferir as cinco páginas, canonical selecionado e último rastreamento |
| Impressões, cliques e CTR | Search Console | Separar /es/ e /sp/; comparar últimos 28 dias completos com os 28 anteriores; anotar dias com dados incompletos |
| Busca pela marca vs demais buscas | Search Console | Separar variações Yincorp; limites de amostragem/consultas anonimizadas documentados |
| Sessões de busca e de IA | GA4 | Landing page + origem/meio; referência de IA identifica visitas reconhecidas, não todas as citações |
| Abertura de ficha/contato e envio | GA4/eventos existentes | Validar eventos já implementados e persistência do lead, sem alterar o contrato de mensuração |
| Leads qualificados e visitas | Operação comercial | Associar origem e página de entrada quando disponíveis; divulgar apenas agregados |
| Citações em IA Microsoft | Bing Webmaster Tools | Pendente de configuração e disponibilidade de dados; citações não equivalem a visitas |

Registrar baseline de desempenho antes de atribuir efeito às melhorias. Para comparação posterior, anotar datas dos releases e alterações de estoque. Mudanças simultâneas, sazonalidade e demanda impedem atribuição causal simples.

## Calendário e critérios de conclusão

| Dias / datas | Entrega | Critério de conclusão |
|---|---|---|
| 1–15 / 02–16 nov | Auditoria pública, primeira melhoria nas cinco páginas, revisão da home SP e baseline de métricas | HTML SSR, canonical, metadata, navegação e testes conferidos; baseline autenticado separado das observações técnicas; iniciar configuração do Bing com o responsável pela conta |
| 16–30 / 17 nov–01 dez | Revisão comercial e local das cinco páginas | Corretores validam contexto e dados; conferir fotos, plantas, memorial e enquadramento de uso das fichas prioritárias |
| 31–45 / 02–16 dez | Escolha de páginas por intenção | Publicar apenas onde houver busca/lead observado, inventário suficiente e conteúdo distinto; decidir entre melhorar a página existente ou abrir uma nova |
| 46–60 / 17–31 dez | Comparações próprias de bairros e plantas | Brooklin × Campo Belo e Moema × Itaim Bibi com critérios explícitos; material de Vitória com revisão local e fontes; não usar ranking de valorização sem dados |
| 61–75 / 01–15 jan | Distribuição e primeira rodada de ajustes | Materiais para parceiros preparados; contatos externos somente mediante autorização; corrigir páginas com impressões e baixo interesse comercial |
| 76–90 / 16–30 jan | Avaliação e próximo ciclo | Comparar indicadores por região e intenção; documentar limites e selecionar expansão com base em leads qualificados |

## Rotina proposta

- Semanal: verificar erros, disponibilidade do inventário, formulários e páginas prioritárias; manter registro dos releases.
- A cada 30 dias: avaliar cliques, fichas vistas, contatos, leads qualificados e visibilidade em IA disponível.
- Encerramento: comparar com a linha de base e decidir aprofundamento/expansão. Não criar centenas de páginas nem executar contatos externos automaticamente.

## Primeiro incremento

Home SP com quatro bairros em foco e distinção explícita entre capital e catálogo estadual. Guias SSR específicos nas quatro páginas e em Vitória, com tabela por uso e tipologia, faixa de área, menor preço informado e quantidade de empreendimentos. Valores são extraídos das mesmas configurações do inventário; uso ausente aparece como "Uso a confirmar". A tabela representa todo o recorte do bairro/cidade, antes dos filtros e paginação, com essa limitação visível.

Encaminhamento de /sp/sao-paulo/brooklin para /sp/sao-paulo/brooklin-paulista somente quando o primeiro bairro não existe e o segundo tem catálogo. Preserva parâmetros; não mistura geografia nem muda URLs de empreendimentos.

Sem mudança de schema, endpoints de lead, Ads, MIA, identidade de visitante ou arquivos de tracking. Sem consultas adicionais ao banco para o guia. Publicação segue núcleo → pin com hashes → Preview → produção, mantendo possibilidade de reverter o pin.

## Fontes locais do primeiro incremento

- Estações da Linha 5-Lilás, operadora: https://trilhos.motiva.com.br/linha-5-lilas/duvidas-frequentes/ — consultado em 02/11/2026. Não implica distância de um imóvel à estação.
- Prefeitura de Vitória: https://www.vitoria.es.gov.br/turista/ — referência para consulta sobre a cidade.

## Limites técnicos conhecidos

A suíte ampliada do portal apresenta três falhas preexistentes, já reproduzidas na base anterior: duas em portal-architecture.test.mjs e uma de contagem em portal-floorplans-open.test.mjs. Elas ficam separadas dos testes deste incremento; não declarar suíte inteira verde.
