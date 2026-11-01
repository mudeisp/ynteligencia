# P0 do portal público — performance e rollback

Base revisada: `9fd544c3243c6aff8b87e286e2426122184e7188`.

Escopo: somente o leitor SSR `portal/inventory.js` e o resolvedor `portal/router.js`, com testes. Sem mudanças em Ads, MIA, eventos, leads, schema ou índices. O www usa esse núcleo por pin de commit no repositório yincorp-landing; alterar somente o núcleo não atualiza o www.

## Comportamento

- SP: identifica o projeto pelo token Órulo já existente na URL; consulta o índice por building_id/estado, lê as unidades pelos mesmos UUIDs e pela mesma projeção anterior. Não carrega nem agrupa o estado inteiro para uma página individual.
- Relacionados: lê somente colunas de identificação/localização/preço da cidade, ordena com a prioridade anterior (bairro, distância de preço inicial, path) e hidrata apenas os três escolhidos. Não expande milhares de unit_facets para decidir três cards. A consulta de resumo ainda pagina cidades com mais de 1.000 projetos: não é uma solução de queries pontuais para todos os relacionados.
- Preço agregado zero/negativo que possa esconder uma configuração positiva restaura a seleção por facets do leitor anterior. Falhas retornam 503; não convertem erros em inventário vazio.
- ES e demais mercados: mantêm a leitura de listagem existente. O agrupamento é reutilizado enquanto a identidade do snapshot estiver válida. `PORTAL_POINT_LOOKUP_STATES` permite outros estados após benchmark; padrão SP. Não muda URLs nem disponibilidade dos mercados.
- Cache de snapshots públicos: TTL de 60 segundos, chave por transporte/estado/finalidade/identificador; coalescência de promessa em andamento; falhas removidas do cache; máximo de 128 entradas por transporte. Não armazena sessão, visitante ou contato.
- WeakMap de agrupamentos acompanha o ciclo de vida do array; sem cache adicional ilimitado. Unidades detalhadas continuam sendo lidas a cada execução SSR. CDN e seus headers mantidos.
- Tokens legados `imovel-*` continuam no resolvedor anterior. Canonical, breadcrumbs, metadata, JSON-LD, links de unidade, campanhas em redirects, SSR e HTML permanecem preservados nos cenários comparados.

## Benchmark reproduzível

Artefatos entregues no workspace: `outputs/portal-p0/benchmark.json`, `live-validation.json` e relatório. Harnesses em `work/performance-audit/benchmark-p0.mjs` e `validate-p0-live.mjs`. O primeiro compara a mesma captura pública nas duas versões; o segundo usa somente GETs públicos reais e renderiza localmente, sem gravar tracking/lead. Executar com Node; não há dependência adicional.

O benchmark usa cinco cenários com comparação byte a byte do HTML, três repetições alternadas e lote adicional de dez renders frios por variante. Bytes de replay são JSON reserializado. CPU local Windows tem resolução limitada, inclusive zero em amostras curtas; usar lote e tempo de event loop como evidência complementar, sem converter em CPU faturada Vercel.

Trade-off explícito: SP frio isolado passa de 4 para 5 GETs, mas reduz o volume e o processamento; quente permanece 1. Três aberturas frias simultâneas passam de 12 para 7. ES frio permanece 2 e quente 1. Não prometer redução universal de requests nem economia percentual de billing a partir do teste local. Catálogo frio continua lendo/agregando o estado; pushdown de filtros/paginação não faz parte deste P0.

Testes novos cobrem concorrência, TTL, falha/recuperação, isolamento de cache, detalhes frescos, URLs/cidade/estado, tipologia, HEAD, redirects com atribuição, rollback, fallback legado, ES e preços anômalos. A suíte da base já tem duas falhas editoriais em portal-architecture.test.mjs, reproduzidas sem este patch (expectativas de narrativa e material oficial Paradiso); não corrigidas fora do escopo.

## Rollback

1. **Chave operacional:** configurar `PORTAL_P0=0` no deployment alvo e redeployar esse deployment. Desliga resolução pontual, coalescência nova e reutilização de agrupamento, restaurando o caminho anterior. A alteração de env só vale em novo deployment; não é um interruptor instantâneo. Não foi alterada nenhuma variável remota nesta entrega.
2. **www:** restaurar o manifesto `portal-source.json` anterior com commit `9fd544c3243c6aff8b87e286e2426122184e7188` e os hashes anteriores de inventory/router. Commit de reversão + novo Preview para conferir. Em produção, somente após aprovação, restaurar o deployment estável anterior ou promover a reversão explicitamente aprovada.
3. **Núcleo:** reverter o commit P0 ou repinar o www no commit anterior; nunca fazer reset/force-push do histórico compartilhado.
4. Conferir 200 dos quatro projetos, canonical www, noindex apenas no Preview, 404/308, JSON-LD e tracking intacto. Observar CPU de /api/portal, erros 503, bytes de origem, requests por sessão e HIT/MISS antes de ampliar estados.

Não há migration, operação de banco ou rollback de índice. O índice protegido `properties_orulo_building_id_all_statuses_idx` não integra o diff.
