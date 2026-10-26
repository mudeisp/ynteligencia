# Explore Espírito Santo v1

Libera a opção `Espírito Santo` no filtro Região do Explorar sem alterar MATCH, pontuação, tracking, leads ou inventário.

## Comportamento
- Ao selecionar `Espírito Santo`, a geografia ativa passa para `state=ES` e cidade fica aberta para todo o estado.
- O catálogo remove o filtro de cidade e mantém `state=ES`, permitindo retornar todo o estoque ativo do estado.
- O seletor Bairro passa a carregar bairros ativos de todo o ES.
- Ao voltar para qualquer região de São Paulo, restaura `city=São Paulo` e `state=SP`.

## Escopo
Mudança limitada ao boot de filtros do Explorar e à leitura geográfica já existente do catálogo.