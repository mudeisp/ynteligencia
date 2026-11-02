# Plantas abertas no desktop — V1

## Objetivo
Reverter apenas a perda de exposição visual introduzida no capítulo de plantas, sem rollback do restante da experiência das LPs.

## Comportamento
- Até 3 plantas com imagem: mantém a sequência aberta existente.
- De 4 a 6 plantas com imagem: desktop mostra todas abertas em grade editorial.
- Mais de 6 plantas com imagem: desktop mostra as 6 primeiras abertas e oferece `Ver todas as plantas` para as demais.
- Mobile preserva o diretório/seletor e navegação anterior/próxima existentes.
- Imagens continuam com `loading="lazy"` e modal de ampliação existente.
- Plantas sem imagem permanecem como descrição textual; nenhuma URL é sintetizada sem evidência do fornecedor.

## Auditoria de dados
Em 2026-11-01, Casa Senses (`orulo-73079`) e Eden Park (`orulo-74314`) possuíam objetos `floor_plans` no `raw_data` com IDs e descrições, porém sem campo de imagem. Os IDs de floor plan também não apareciam no array `building.images`. Por isso a correção não inventa URLs para esses casos.

## Escopo preservado
Sem alteração em Ads, MIA, tracking, leads, Supabase schema, canonical, rotas, sitemap ou P0 de performance.
