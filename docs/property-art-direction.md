# Empreendimentos Yincorp — arquitetura como experiência

Proposta visual implementada apenas em branches e Preview. Caso de referência: /es/vila-velha/empreendimento/paradiso-residencial--orulo-83252. Sistema de apresentação aplicado a todos os empreendimentos, com curadoria adicional do Paradiso.

## Direção

Uma capa de arquitetura, não uma ficha de produto. O nome monumental se relaciona com a proporção vertical da fachada. A abertura reúne somente lugar, nome, incorporadora e status. Preço e atendimento aparecem depois da experiência visual.

Narrativa: capa → introdução curta do conteúdo real → imagem ampla → dupla assimétrica de ambientes → filme → números essenciais → plantas → amenidades → lugar → incorporadora → disponibilidade e contato → ficha complementar e outros projetos.

DM Serif Display traz contraste e presença aos títulos sem usar Cinzel, ornamentos ou dourado. Inter organiza metadata e interface. Ivory, stone e grafite azulado funcionam como moldura; um verde acinzentado diferencia plantas e localização. Fotografias e renders ganham escalas variadas, sem cards ou sombras. O mobile possui capa, sequência fotográfica e seleção de planta próprias.

Plantas: diretório à esquerda e desenho amplo à direita em desktop; seleção simples e imagem grande em celular. Zoom nativo. Não são inventadas associações por unidade: área e dormitórios vêm da descrição da planta; suítes/vagas só aparecem quando há configurações com a mesma metragem no catálogo, identificadas como características de catálogo a confirmar.

Os cards relacionados e do catálogo foram simplificados como recortes editoriais: imagem, lugar, nome, área/dormitórios, preço e status discreto. Sem badges, sombras ou excessos de informação.

## Material e fontes

Inventário real do Paradiso: 32 imagens, 28 plantas com imagem, configurações de 56,72 a 254,22 m² e preço inicial informado de R$ 990.158,26 na consulta desta rodada. Valores continuam calculados em tempo de leitura.

O inventário estava com videos=[] e virtual_tour=null. O filme e o tour presentes no site oficial foram verificados e adicionados como curadoria de apresentação, sem escrever no Supabase, alterar a sincronização ou duplicar inventário. Fonte: https://www.paradisorc.com.br/, do empreendimento da Canal Construtora na Rodovia do Sol, 1742. Vídeo: https://www.youtube.com/watch?v=S_6EmQoOQe0. Tour de 2 quartos: https://tour.meupasseiovirtual.com/view/uemd5Im0hqf.

Fachada, piscina, convivência e fitness da narrativa usam os arquivos reais já publicados no site oficial: images/fachada01.jpg, images/fachadarua.jpg, images/lazer/01.jpg, 02.jpg, 09.jpg e 14.jpg. Foi feita conferência visual do material. São perspectivas ilustradas, assim identificadas. As plantas vêm do inventário Órulo; seis desenhos também possuem uma versão publicada no site oficial, conferida visualmente pela metragem e usada na apresentação por estabilidade de carregamento. Os demais URLs de planta permanecem os do inventário. Nada é escrito ou substituído no banco. O catálogo fotográfico original permanece disponível pela galeria completa.

A frase curta do Paradiso é baseada na pergunta inicial de sua descrição real. Não foram inventadas distâncias, pontos próximos, diferenciais ou promessas técnicas. A descrição completa permanece disponível nos detalhes finais. A fonte oficial é vinculada junto ao filme e ao crédito da incorporadora.

## Implementação e preservação

portal/architecture.js implementa a composição reutilizável e a curadoria. property-story.css é carregado somente nas páginas de empreendimento/tipologia; a folha compartilhada segue responsável pelo header/footer e formulário. property-story.js só trata seleção de planta, ampliação e player sob demanda. Nenhuma dependência adicional de servidor ou API comercial.

Preservados SSR, URLs, canonical www, breadcrumbs, sitemap, schema, inventário, integrações e captura. Arquivos de lead, tracking, visitor/session/atribuição e analytics mantidos byte a byte. Nenhum banco novo, backfill, mudança de credenciais, merge ou promoção. Preview continua noindex e com envios/tracking desativados.

## Validação

Testes existentes atualizados somente onde a composição mudou: um canvas de plantas com várias seleções, novo rótulo do mapa e novos títulos relacionados. Casos adicionais verificam a ordem editorial, presença do filme, ausência de preço/CTA na capa, tratamento de material ausente e preservação do modelo.

Revisão visual em 1440px e 390px, com capturas completas. Vídeo é carregado sob demanda para manter a fotografia de abertura e evitar uma lista de embeds. O acionamento do player e os URLs foram verificados; não foi reproduzido o filme integralmente como teste nem criado contato real.
