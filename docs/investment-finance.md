# Simulador financeiro de locação curta — modelo v1

## Escopo e origem dos dados

O inventário fornece projeto, configuração e preço anunciado, área, dormitórios, vagas, estágio, entrega e estoque. Não fornece diária, ocupação, condomínio, IPTU, mobília ou custos operacionais nesta seleção. Escolher uma configuração copia somente o preço para o campo de aquisição, editável e com origem identificada; a referência original permanece visível. Não se infere permissão condominial. Não existe controle para conceder selo de aptidão.

O registro `portal/investment-benchmarks.js` está vazio por ausência de fonte operacional local verificada. A arquitetura aceita cidade, bairro, métrica, unidade, valor, período, fonte/URL, atualização e método (média, mediana ou estimativa), validados em `finance-model.js`. A interface mostra essas informações sem preencher automaticamente hipóteses. Benchmarks nunca viram previsão do projeto. Não foi criada tabela: nenhum cadastro adequado foi encontrado no código, e um registro editorial revisado é suficiente para este lançamento. Cadastro administrativo pode ser acrescentado depois com revisão de fonte e licença.

Todos os demais números são hipóteses do usuário. Os três cenários começam sem diária, ocupação ou custos, e são independentes. Os nomes Conservador/Base/Otimista não atribuem probabilidade ou garantia. É possível copiar explicitamente o Base para outro cenário. Nenhuma chamada a IA, biblioteca financeira ou endpoint é usada no cálculo.

## Fórmulas e convenções

Valores em reais. Taxas de entrada em porcentagem; cálculo sem arredondamento intermediário, apresentação com até duas casas. Mês-modelo tem noites disponíveis informadas pelo usuário, entre 1 e 31. Anualização repete o mês doze vezes e não modela sazonalidade. Não projeta receita até a entrega ou valorização/revenda.

| Métrica | Fórmula |
|---|---|
| Noites ocupadas | noites disponíveis × ocupação / 100 |
| Reservas aproximadas | noites ocupadas / estadia média; frações são aproximação, não reservas realizadas |
| Receita bruta mensal/anual | diária × noites ocupadas; anual = mensal × 12 |
| Limpeza | reservas aproximadas × custo por reserva; sem cobrança de limpeza ao hóspede |
| Plataforma, gestão, impostos | receita de diárias × percentual / 100, separadamente |
| Fixos mensais | condomínio + IPTU anual/12 + internet + energia + seguro + manutenção |
| Custo operacional | fixos + limpeza + plataforma + gestão + impostos |
| Receita operacional líquida | receita bruta − custo operacional, antes da dívida |
| Implantação | mobília/implantação + enxoval + decoração + equipamentos + reserva inicial |
| Custos adicionais de aquisição | ITBI + escritura/registro + taxas + corretagem |
| Capital total do projeto | preço de aquisição + custos adicionais + implantação |
| Capital próprio | preço sem financiamento, ou entrada com financiamento, mais custos adicionais e implantação |
| Gross yield | receita bruta anual / preço de aquisição × 100 |
| Net yield | receita operacional líquida anual / capital total × 100 |
| Cap rate simplificado | receita operacional líquida anual / preço de aquisição × 100; inclui impostos operacionais informados, não constitui laudo |
| Cash-on-cash | fluxo anual após dívida / capital próprio × 100; só com financiamento |
| Payback simples | capital total / receita operacional líquida anual positiva, em anos, antes da dívida; sem desconto temporal |
| Margem por noite | diária × [1 − (plataforma+gestão+impostos)/100] − limpeza/estadia média |
| Ocupação de equilíbrio | fixos / (noites disponíveis × margem) × 100; após dívida soma parcela aos fixos |

Cada métrica fica nula quando seus insumos estão ausentes ou o denominador não é válido. Campos vazios não são gratuitos. Zero precisa ser informado explicitamente. Operação negativa é exibida; payback só é calculado para resultado operacional positivo. Equilíbrio com margem não positiva não tem solução finita; acima de 100% é sinalizado como inviável no mês-modelo.

Financiamento usa Price de taxa fixa: i = (1 + taxa efetiva anual/100)^(1/12) − 1; parcela = principal × i / [1 − (1+i)^(-meses)]. Taxa zero usa principal/meses. Entrada + financiado deve coincidir com aquisição (tolerância de um centavo). O fluxo mensal mostra o primeiro mês de operação. O anual deduz min(12, prazo) parcelas para não cobrar dívida já encerrada. Não inclui indexação, CET, carência, seguros bancários, parcelas de obra ou saldo devedor em uma data futura. Referência educativa: https://www.consumerfinance.gov/ask-cfpb/how-does-paying-down-a-mortgage-work-en-1943/ — separação entre principal e juros, não oferta de crédito ou regra brasileira.

## Alertas de revisão

Ocupação acima de 85%; diária mais de 30% acima de referência externa cadastrada no mesmo recorte; manutenção zero; condomínio ausente; mobília zero sem confirmação de mobiliado; impostos zero; gestão zero com operação terceirizada; payback simples inferior a 5 anos; margem não positiva e equilíbrio inviável. Limiares são regras editoriais de revisão, não estatísticas de probabilidade. Alertas não bloqueiam simulação.

## Comparação e lead

Comparação mantém até três empreendimentos, na ordem de inclusão. Não ordena por yield nem altera o ranking de aderência ao perfil. Cada coluna guarda cenário e hipóteses usadas, com acesso aos detalhes, e pode ser removida ou atualizada.

Hipóteses e comparação ficam só em memória até o CTA explícito de atendimento. Nesse momento, a simulação é guardada na sessão da jornada por até 30 minutos para atravessar a navegação até a ficha; não vira lead identificado automaticamente. Ao escolher outro empreendimento, a simulação anterior é descartada do contexto. Se o usuário trocar a configuração no formulário de contato, precisa selecionar a configuração simulada ou refazer o cenário, evitando anexar números de outra unidade.

`investment_context.simulation` v1 separa `inventory`, `benchmark`, `user` e `result`. O backend saneia entradas e recalcula métricas, ignorando resultados fornecidos pelo navegador. A referência de inventário é um snapshot do cliente que exige reconfirmação comercial. O payload inclui perfil/objetivo e touches existentes. A mensagem comercial e o link de WhatsApp pós-sucesso indicam cenário, diária, ocupação e capital hipotéticos; o contexto estruturado mantém as métricas. Mantém success+supabase como condição de continuação.

Eventos novos: investment_simulator_opened, investment_scenario_changed, investment_assumption_changed, investment_comparison_started, investment_simulation_completed, investment_project_selected_from_simulator e investment_lead_created. Usam eventos existentes sem schema novo. Dimensões permitidas: ID público do projeto, cenário, nome do campo e quantidade comparada; nenhum valor de diária, patrimônio, entrada, dívida, taxa ou renda vai para os eventos. O contexto da simulação é removido também dos eventos genéricos da jornada/lead. Preview desativa tracking, envio de lead e gravação de preferências da jornada.

## SEO, performance e publicação

Conteúdo, comparação, formulários e fórmulas continuam SSR. A interação só inicializa ao abrir o simulador. Sem imagens novas, dependências pesadas, parâmetros financeiros em URL ou requisições de cálculo. Canonical e sitemap permanecem os mesmos; a navegação de unidade usa o noindex já existente e preserva atribuição.

Testes específicos cobrem contas independentes, cenários, Price, limpeza, custos, yields, capital próprio, payback, equilíbrio, alertas, limite de comparação, origem de dados, privacidade de eventos, expiração e contexto do lead. Publicação deve atualizar o pin com hashes dos novos módulos compartilhados e do navegador. Não mergear antes da revisão do conjunto jornada + simulador e da validação dos Previews. Campanhas Google Ads não são alteradas.
