# Sistema editorial de empreendimentos Yincorp

O Paradiso aprovado é a referência de direção de arte. A capa, tipografia de produto, curadoria, enquadramentos e sequência continuam como base. A abstração não estabelece temas por preço: R$ 300 mil, R$ 1 milhão e R$ 5 milhões usam a mesma identidade.

## Arquitetura

| Módulo | Regra |
| --- | --- |
| Cover | Imagem principal/curadoria verificada, orientação conhecida ou dimensão intrínseca; abertura tipográfica se não houver imagem |
| Manifesto | Texto real/curadoria ou nome e lugar; compacto quando não houver corpo de texto |
| Image Story | Até quatro imagens selecionadas na narrativa, com A/B/C/D; sem repetir a única foto do hero |
| Film | Principal sob demanda e episódios quando houver mais conteúdo; sem módulo se não houver vídeo/tour |
| Essence | Três a cinco fatos conhecidos quando houver material suficiente; não inventar números para completar a faixa |
| Floor Plans | 1–3 em sequência ampla; 4–10 em diretório lateral; mais de 10 em categorias |
| Amenities | Até oito destaques e lista completa expansível; imagem apenas quando houver uma não repetida disponível |
| Location | Bairro/cidade e endereço; mapa somente com coordenadas, composição textual se não houver mapa |
| Developer | Crédito só quando houver incorporadora informada |
| Availability | Preço forte no final, ou valores sob consulta quando ausentes; configurações agrupadas |
| Technical Details | Conteúdo secundário real, sem grade técnica vazia |
| Related Projects | Projetos reais da cidade; grid adaptado a um, dois ou três resultados |

portal/composition.js planeja a página sem rede ou mutações. portal/architecture.js renderiza os módulos habilitados no HTML SSR. portal/floor-plans.js cuida das três composições de plantas. portal/editorial-sources.js contém apenas material complementar revisado. Os estilos e interações são compartilhados; os adaptadores comerciais continuam os mesmos.

## Regras de fotografia

- A: imagem ampla.
- B: imagem vertical/natural com texto editorial.
- C: par assimétrico, com deslocamento e respiro.
- D: imagem maior e detalhe menor.

Com duas imagens no total, a única imagem restante recebe A ou B conforme a orientação conhecida. Com três, a narrativa recebe C (ou D se houver detalhe identificado). Com quatro, A + C. Com cinco ou mais, A + B + D, limitado ao material selecionado. Em galerias extensas, a seleção é distribuída na sequência disponível para evitar usar somente variações adjacentes da fachada. URLs duplicados são removidos.

Não há classificação visual por IA nem busca indiscriminada de imagens. Metadados de orientação e função são aproveitados quando existentes; na sua ausência, o navegador usa a proporção intrínseca da imagem principal. Fotos do ensaio preservam proporções naturais. Isso não inventa informação semântica sobre a imagem. Curadoria verificada pode definir a escolha e o enquadramento.

O Paradiso mantém A + C, com sua foto complementar de amenidades. A galeria completa preserva os URLs originais e carrega a imagem selecionada sob demanda. A narrativa não mostra 20 ou 30 fotos em sequência.

## Plantas e configurações

Categorias possíveis: Implantação; 1, 2, 3, 4, 5+ dormitórios; Garden; Cobertura; Outras plantas quando o texto não permite classificação. Não inferir dormitório de planta sem descrição. Um desenho pertence a apenas uma categoria. O seletor mobile usa optgroups; desktop usa diretório de categorias com contagem, sem coluna plana de 30 itens. A planta ativa permanece grande e ampliável.

Categorias vêm dos títulos/tipos reais das plantas. Área e dormitórios vêm da descrição; suítes e vagas só aparecem quando há configurações da mesma metragem no catálogo. Isso continua explicitamente sujeito à confirmação, sem inventar associação entre uma unidade e uma planta.

Configurações são agrupadas por Garden/Cobertura ou número de dormitórios informado. Área, suítes, vagas, preço original/atual e disponibilidade continuam nos registros reais, dentro de “Compare as configurações”.

## Enriquecimento oficial

Prioridade: complemento verificado → inventário Órulo existente → composição reduzida com o que houver. A estrutura não depende do Paradiso. Sua ficha de curadoria está isolada no registro de fontes, com data de verificação e origem. Não há scraping automático, banco novo, reimportação ou descoberta de URLs em runtime. Sem registro verificado, nenhum material externo é usado.

Os dados oficiais adicionais do Paradiso, incluindo imagens, filme e tour já aprovados, permanecem. Os outros casos de validação usam apenas o inventário existente. A consulta ao catálogo não depende de o site oficial do Paradiso responder.

## Tipografia, mobile e desempenho

Serif principal única: DM Serif Display (nome, headlines, preço e números). Inter: navegação, UI, rótulos, dados e metadata. Cormorant foi removida dos recursos ativos; não há duas identidades tipográficas simultâneas.

Cada composição possui regras mobile. Nomes longos quebram sem extrapolar a tela; paisagens têm abertura própria; pares assimétricos tornam-se uma sequência com deslocamento; plantas usam seletor ou sequência ampla; preço recebe tamanho fluido; relacionados não deixam colunas vazias. O CTA fixo continua restrito à fase comercial da narrativa.

Hero eager/fetchpriority high; demais imagens lazy; nenhuma montagem de iframe antes de interação; galeria completa sem download inicial de todos os arquivos; sem novas bibliotecas de cliente, requests de tracking ou alterações de storage de identidade.

## Fallbacks

| Material | Composição |
| --- | --- |
| 30 fotos + vídeos + plantas | Capa + ensaio limitado + filme/episódios + plantas adaptadas + módulos reais |
| 10 fotos + plantas, sem vídeo | Ensaio reduzido; vídeo omitido sem reserva de espaço |
| 4 fotos, nenhuma planta | Capa + A/C + essência, lugar e disponibilidade; plantas omitidas |
| Imagem única | Capa forte + manifesto/essência + módulos existentes; nenhuma repetição para fabricar galeria |
| Nenhuma foto | Abertura tipográfica deliberada; nenhum quadro vazio ou aviso de material indisponível |

## Validação e limites

43 testes do núcleo, incluindo limites de seleção, ausência de material, quatro composições, faixas de plantas, agrupamentos, curadoria verificada, não mutação e invariância de composição entre tickets. Verificação de renderização dos 172 empreendimentos: sem erro, H1 único e sem texto undefined/NaN.

Casos visuais de 1440px e 390px: Paradiso (32 fotos, 28 plantas e material oficial), Youniverse Studios (14 fotos, 27 plantas e quatro mídias) e Vista Tropical (imagem única, 17 plantas, sem vídeo; preço inicial consultado R$ 284.850,64). Todos usam a mesma linguagem. Capturas e resultado do navegador acompanham a entrega.

SSR, canonical www, metadata, breadcrumbs, schema, URLs, sitemap e APIs existentes preservados. Arquivos de captura, sessão, visitor/session IDs, GCLID, UTMs e eventos não foram alterados. Preview noindex e sem envios/tracking. Sem merge, promoção, DNS ou alteração no banco/produção.
