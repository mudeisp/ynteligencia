# QA semântico do sistema editorial

A direção de arte aprovada foi preservada. Nenhum CSS, fonte, player, imagem, CTA ou contrato de API foi alterado.

## Regras compartilhadas

`portal/semantics.js` deriva a natureza das unidades de `typology_type`/`unitType`. Reconhece terreno/lote, studio, casa, apartamento e loft; conserva produtos mistos, outros e desconhecidos. Garden/cobertura/duplex são variações residenciais; vertical + finalidade residencial é apenas fallback quando não há tipo de unidade. Horizontal sozinho nunca significa casa. Nome comercial, preço, fotografia e zero dormitórios não classificam o produto.

Cards, essência, ficha, configurações, metadata e JSON-LD usam os mesmos fatos. Terrenos não recebem dormitórios, suítes, banheiros ou vagas residenciais. Outros produtos exibem contagens positivas reais; studio explícito pode substituir zero dormitórios por “Studio”. Zeros originais permanecem no inventário e payload comercial. Estoque zero continua sendo informação factual.

Lotes priorizam área dos lotes, quantidade total, entrega ou status e localização. Produtos prontos usam seu estágio na essência; a data histórica continua secundária na ficha. Tipos mistos usam representação genérica quando não há sustentação para condomínio de apartamentos. Plantas preservam as imagens e omitem métricas residenciais zeradas.

Schema: `ApartmentComplex` somente quando o tipo residencial de apartamento é sustentado; `Place` para loteamento, casas/conjuntos horizontais, mistos incompatíveis e desconhecidos. `WebPage`, `BreadcrumbList`, endereço, imagens, incorporadora, preço e propriedades reais permanecem. Referências: https://schema.org/ApartmentComplex e https://schema.org/Place. Não se presume direito a rich results.

## Antes e depois

| Caso | Antes | Depois |
| --- | --- | --- |
| Costa dos Corais | 0 quartos/vagas, Sem dormitórios, ApartmentComplex | Lotes de 300 a 742,17 m², 147 lotes no projeto, entrega 2029, Place |
| Studio com zero dormitórios | 0 dormitórios | Studio, mediante tipo explícito |
| Apartamento com zero vagas | 0 vagas | Omite vaga; mantém dormitórios reais |
| Canal al Mare | Ano 2019 como grande número de entrega | Pronto novo na essência; entrega histórica na ficha |

## Validação

Fixture real de Costa dos Corais, com projeção pública mínima do inventário consultado em 27/10/2026, em `test-support/fixtures/costa-dos-corais.json`. Testes cobrem apartamento, studio, loteamento, vaga zero, pronto, sem planta, alto ticket, casa, loft, mistura e natureza desconhecida. Auditoria SSR de 172 empreendimentos sem zeros residenciais indevidos, mutação, NaN ou H1 duplicado.

Casos de revisão: Paradiso Residencial; Youniverse Studios; Vista Tropical; Costa dos Corais; Canal al Mare; PDCC 300 Apto 620231013-21 (sem plantas). Preview somente, sem merge ou promoção.
