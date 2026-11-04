# Órulo SP — 83 empreendimentos preparados

Auditoria somente leitura em 2026-11-04T15:20:44.002Z. Referência concluída: Basílio 177, building 43126. Nenhuma recuperação, autorização administrativa ou migração de produção executada nesta preparação.

Dos 99 IDs originais: piloto 43126 concluído, 38740 sem unidades ativas, 14 outros sem referências de imagem ausentes, 83 elegíveis. O ID 86644 permanece excluído. São 314 UUIDs, 2.059 ocorrências de plantas sem imagem e 479 associações de plantas/URLs distintas recuperáveis.

A origem foi conferida pelo endpoint GET existente app.yincorp.com.br/api/development, cujo código consulta a API Órulo de plantas; cada ID de planta foi associado à URL retornada. A acessibilidade HTTPS/CDN foi verificada. URLs com nomes aleatórios ou MIME genérico também tiveram assinatura binária JPEG/PNG/WEBP conferida. Isto não equivale a validação visual de todas as plantas nem decodificação integral dos arquivos. O executor refaz a consulta autenticada Órulo e verifica assinatura binária antes de apresentar o plano.

Hash SHA-256 do master (JSON.stringify do documento): `d670eb2cc7ab60cfc76e0ef08b466e9c9b503df64047d57519a34e7ed57f63b2`. Manifestos arquivados preservam UUIDs e IDs de plantas; novos UUIDs/plantas ausentes causam drift e exigem revisão. Uma planta já preenchida é excluída na leitura atual.

| Lote | Buildings | UUIDs | Plantas sem imagem | URLs distintas |
|---|---:|---:|---:|---:|
| phase1-20 | 20 | 33 | 135 | 81 |
| phase2-30-a | 30 | 95 | 454 | 152 |
| phase2-30-b | 30 | 157 | 1236 | 222 |
| phase3-rest | 3 | 29 | 234 | 24 |

A primeira fase prioriza menos imóveis e menos plantas distintas por empreendimento; todos os 83 tiveram origem e acessibilidade confirmadas. As duas expansões têm até 30 buildings; a conclusão possui 3. URLs podem se repetir entre imóveis do mesmo empreendimento.

| Building | Empreendimento | UUIDs elegíveis | Plantas sem imagem/recuperáveis | URLs distintas | Lote |
|---|---|---:|---:|---:|---|
| 2920 | Station Residence MBigucci | 2 | 8 | 4 | phase1-20 |
| 3198 | Alvorada Residence | 2 | 6 | 3 | phase1-20 |
| 3207 | Quartier Auri | 1 | 2 | 2 | phase1-20 |
| 3349 | Follow Santo André | 3 | 12 | 4 | phase2-30-a |
| 4075 | Marco Zero Mix Residence | 4 | 20 | 5 | phase2-30-b |
| 4836 | America - Fase 1 | 2 | 6 | 3 | phase1-20 |
| 4969 | Inspire Ibirapuera | 2 | 12 | 6 | phase1-20 |
| 5303 | Origens Santana | 4 | 12 | 3 | phase2-30-a |
| 5422 | ON Melo Alves - Residencial | 4 | 52 | 13 | phase2-30-b |
| 20283 | Level Brooklin - Residencial | 3 | 21 | 7 | phase2-30-a |
| 20333 | Lure Perdizes | 2 | 16 | 8 | phase2-30-a |
| 20407 | Praça Lindenberg Macurapé | 5 | 55 | 11 | phase2-30-b |
| 20632 | H.Paulista - Residencial | 1 | 4 | 4 | phase1-20 |
| 20980 | Blues Perdizes | 2 | 12 | 6 | phase1-20 |
| 21449 | Felicittá Residencial | 1 | 3 | 3 | phase1-20 |
| 21605 | Casa Jardim Itaverá | 3 | 15 | 5 | phase2-30-a |
| 21642 | Quinta do Lago | 2 | 8 | 4 | phase1-20 |
| 22027 | KAÁ | 2 | 8 | 4 | phase1-20 |
| 24562 | Casa Real | 4 | 8 | 2 | phase2-30-a |
| 25147 | In Design Ipiranga | 3 | 12 | 4 | phase2-30-a |
| 27313 | Today Vila Mariana - Residencial | 2 | 14 | 7 | phase2-30-a |
| 27977 | Fit Casa Estação Oratório | 1 | 3 | 3 | phase1-20 |
| 29350 | Hub Brooklin by EZ - Residencial | 5 | 25 | 5 | phase2-30-b |
| 31789 | Vivenci Guaianases | 3 | 9 | 3 | phase2-30-a |
| 36776 | Mirant Ibirapuera | 5 | 20 | 4 | phase2-30-b |
| 38041 | Fazenda Itapety by Helbor - Fase 2 | 1 | 1 | 1 | phase1-20 |
| 38427 | Origem Guilhermina - NR | 3 | 9 | 3 | phase2-30-a |
| 39280 | B.Connect Perdizes - Residencial | 5 | 40 | 8 | phase2-30-b |
| 40196 | Praça dos Omaguás Pinheiros | 1 | 12 | 12 | phase1-20 |
| 40580 | Altto da Bela Vista | 8 | 104 | 13 | phase2-30-b |
| 41230 | LIS Moema Íle Saint-Louis - Residencial | 7 | 112 | 16 | phase2-30-b |
| 41663 | Palazzo Grimaldi | 2 | 6 | 3 | phase1-20 |
| 42122 | Exuberance MBigucci - Fase 1 | 2 | 4 | 2 | phase1-20 |
| 42586 | Living United Ipiranga | 4 | 24 | 6 | phase2-30-b |
| 43537 | WALKBITTENCOURT - NR | 2 | 10 | 5 | phase1-20 |
| 46609 | Táone Vila Mariana - Residencial | 6 | 54 | 9 | phase2-30-b |
| 46652 | Today Saúde - Residencial | 6 | 42 | 7 | phase2-30-b |
| 49267 | DF345 Vila Clementino | 3 | 21 | 7 | phase2-30-a |
| 50575 | Elev Alto do Ipiranga | 1 | 2 | 2 | phase1-20 |
| 51327 | Torino Morumbi | 2 | 8 | 4 | phase1-20 |
| 51452 | Infinity Vila Matilde - Residencial | 3 | 12 | 4 | phase2-30-a |
| 51496 | Terrarium Perdizes | 6 | 102 | 17 | phase2-30-b |
| 55630 | Influencer Vila Mariana | 9 | 81 | 9 | phase3-rest |
| 59964 | Elev Park Sacomã | 3 | 12 | 4 | phase2-30-a |
| 63635 | Today Alto da Boa Vista - Residencial | 2 | 10 | 5 | phase1-20 |
| 64647 | Voga Flórida - NR | 4 | 4 | 1 | phase2-30-a |
| 65572 | Blend 468 | 4 | 24 | 6 | phase2-30-b |
| 65646 | 280 Mateus Grou | 6 | 6 | 1 | phase2-30-b |
| 66288 | Elev Park Sacomã II | 4 | 16 | 4 | phase2-30-b |
| 66664 | Arte Santa Marina | 3 | 15 | 5 | phase2-30-a |
| 66668 | Start Park Jabaquara | 4 | 8 | 2 | phase2-30-a |
| 67082 | View JT - Residencial | 5 | 30 | 6 | phase2-30-b |
| 67183 | Haus Mitre Station Brooklin - Residencial | 3 | 24 | 8 | phase2-30-a |
| 70879 | VP Moema | 6 | 42 | 7 | phase2-30-b |
| 71044 | Cidade Lapa Pompéia - Residencial | 3 | 24 | 8 | phase2-30-a |
| 71097 | Parque Diálogo Vila Ema Residences | 11 | 99 | 9 | phase3-rest |
| 72335 | Trendfy Paulista | 3 | 12 | 4 | phase2-30-a |
| 73923 | ON Melo Alves - NR | 7 | 91 | 13 | phase2-30-b |
| 74315 | Grand Vivaz Penha | 3 | 27 | 9 | phase2-30-a |
| 74610 | Barra Funda 930 | 4 | 24 | 6 | phase2-30-b |
| 74738 | Grand Vivaz Estação Tamanduateí 1 | 2 | 10 | 5 | phase1-20 |
| 75971 | The New Residence Brooklin by Living | 7 | 77 | 11 | phase2-30-b |
| 75973 | Iberius Jardim São Paulo - NR | 3 | 51 | 17 | phase2-30-a |
| 76053 | Elev Butantã | 4 | 20 | 5 | phase2-30-b |
| 76145 | Ânima Vila Matilde | 5 | 30 | 6 | phase2-30-b |
| 78018 | Grand Vivaz Jardim França Paris | 4 | 24 | 6 | phase2-30-b |
| 78437 | Floravita Residencial Clube - Fase 1 | 4 | 24 | 6 | phase2-30-b |
| 80096 | Palm Collection Pacaembu | 3 | 18 | 6 | phase2-30-a |
| 80450 | Auren Studios Vila Clementino | 4 | 16 | 4 | phase2-30-b |
| 81308 | Grand Vivaz Jardim França Versalhes | 3 | 27 | 9 | phase2-30-a |
| 81348 | Château Jardin Harmonie | 9 | 54 | 6 | phase3-rest |
| 81351 | Today Platina | 4 | 8 | 2 | phase2-30-a |
| 81726 | Grand Vivaz Estação Giovanni Gronchi | 4 | 8 | 2 | phase2-30-a |
| 82011 | Elev Anhaia Mello | 6 | 18 | 3 | phase2-30-b |
| 82124 | Claris - NR | 3 | 3 | 1 | phase2-30-a |
| 82828 | Cidade Lapa Perdizes | 5 | 35 | 7 | phase2-30-b |
| 83026 | Grand Vivaz Estação Tamanduateí 3 | 5 | 25 | 5 | phase2-30-b |
| 83366 | Look Vila Prudente | 4 | 12 | 3 | phase2-30-b |
| 84525 | Mérito Ipiranga - Fase 1 | 3 | 18 | 6 | phase2-30-a |
| 85474 | Abiatar Conecta | 8 | 72 | 9 | phase2-30-b |
| 85486 | Viva Mutinga | 4 | 4 | 1 | phase2-30-a |
| 86085 | Safira Condomínio Clube - Fase 1 | 3 | 9 | 3 | phase2-30-a |
| 86526 | Cube XL Adibo | 3 | 21 | 7 | phase2-30-a |

Os manifestos master e por lote contêm a lista exata dos 314 UUIDs, IDs de plantas e 479 URLs de origem. Não são baseline de escrita: baseline V2 integral é capturado novamente após autorização e imediatamente antes das operações.
