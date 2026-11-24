# Yincorp Studio · Atypik × Escape Eden

A apresentação foi preparada para Mariana, cliente fictícia que valoriza planta familiar, privacidade, vegetação e bem-estar. Atypik é a proposta principal. Escape Eden é uma referência qualitativa para explorar o lazer e a integração ao entorno urbano.

## Revisão editorial

| Critério | Atypik | Escape Eden · Cyrela |
|---|---|---|
| Arquitetura | Concreto aparente, grandes caixilhos e jardineiras lineares. Book A, p. 5. | Perspectivas da fachada e lobby de pé-direito duplo. Book B, p. 8–11. |
| Natureza | Espécies nativas e irrigação automática nas jardineiras. Book A, p. 6. | O parque e a área superior a 40 mil m² são descritos no escopo do complexo de seis quarteirões. Book B, p. 5–6. |
| Lazer | Quadra de beach tennis, piscinas, fitness com varanda, spa lounge e sauna seca. Book A, p. 9–10, 15. | Piscinas interna e externa, Escape SPA e sauna na implantação de lazer. Book B, p. 26. |
| Plantas | Manacá de 201 m², três suítes com closet, três ou quatro vagas determinadas. Penthaus de 394 m² e quatro vagas. Book A, p. 16 e 20. | Plantas residenciais de 50, 70, 74, 76 e 94 m², penthouse de 183 m² e seção dedicada a studios. Book B, p. 27–41. |
| Privacidade | 28 apartamentos, hall social privativo e elevador social com biometria. Book A, p. 2 e 21. | A implantação distingue lobby, entrada de serviço, acesso à garagem e portaria. O Private Pool House consta como perspectiva de ambiente. Book B, p. 22 e 25. |
| Engenharia | Infraestrutura de ar-condicionado nas unidades. Entrega do equipamento no fitness e salão de festas documentada separadamente. Book A, p. 21. | A planta de 94 m², final 5, diferencia infraestrutura para ar-condicionado e misturadores entregues nos banhos e cozinha. Book B, p. 30. |
| Financeiro | Preço, fluxo e unidade negociável dependem de confirmação da tabela vigente. | Preço, fluxo e unidade negociável dependem de confirmação da tabela vigente. |

A comparação das plantas favorece a leitura lado a lado de escopos explícitos. As implantações e perspectivas entram como evidência visual. As opções ilustradas permanecem condicionadas ao projeto e ao memorial aplicáveis. O parecer recomenda verificar primeiro a planta familiar de 201 m² e avaliar separadamente as opções de 94 m² e 183 m².

## Inventário e cobertura

- `Apresentação (5)(1).pdf` tem 25 páginas. A leitura do texto abrangeu as 25 páginas, com 130 referências internas a imagens no PDF. A galeria contém 11 pranchas selecionadas.
- `Book(1).pdf` tem 45 páginas. A leitura do texto abrangeu todas as páginas com camada textual. As páginas 1, 2, 37, 44 e 45 não têm texto extraível. O documento tem 243 referências internas a imagens, com 12 pranchas selecionadas.
- As 23 pranchas são renderizações proporcionais dos PDFs em WebP. O [inventário técnico](studio-pilot-inventory.json) registra os hashes e as páginas. Cada figura e cada atributo apresentado aponta para o book e a página.
- Os books de origem ficaram restritos ao processamento e à revisão. Para os próximos clientes, o Studio permite importar PDFs em um bucket privado, armazenar extrações por hash e inserir no rascunho apenas os atributos que o operador confirmar.

## Reuso e operação

O Studio usa a busca de inventário do app e a API Yincorp Intelligence do portal para alternativas. O piloto transforma a sequência comercial existente em dados e um renderer HTML comum, inspirado em Guilherme Vita, Lucas Schoch, Bruno, Renata Bonilha e Mandarim. As rotas personalizadas anteriores continuam independentes.

A autorização usa Supabase Auth com a autorização administrativa `app_metadata.yincorp_studio`. O Supabase compara a identidade do operador com o proprietário do registro nas políticas RLS. A leitura da versão publicada usa o identificador opaco e valida expiração e senha, quando configuradas. O Studio exige aprovação da revisão e conserva versões publicadas. O domínio do portal requer o PR complementar do repositório yincorp-landing.

As apresentações do Studio registram telemetria própria mediante consentimento. A revisão tem acesso aos sinais por apresentação. A migration de integração encaminha eventos deduplicados à tabela comportamental existente quando ela está presente. A classificação da identidade do destinatário permanece indisponível para links anônimos. As tabelas de campanhas e conversões ficam fora do fluxo.

## Publicação

Após aprovação do piloto e fechamento dos testes operacionais, aplicar as migrations no Supabase de produção em ordem, vincular os operadores autorizados, configurar o Studio na Vercel e validar o app. Em seguida, publicar o roteamento do portal e confirmar acesso, proteção, expiração e revogação de uma apresentação de teste no domínio final.
