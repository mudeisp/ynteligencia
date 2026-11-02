# Vitória: jornada de investimento

## Contratos e limites

Uma única landing permanece SSR e indexável em `/es/vitoria/investimento-airbnb`. Comparação e editorial usam o mesmo inventário/cache. O formulário e ranking são progressivos, sem bibliotecas, novas imagens ou chamadas adicionais ao inventário. O módulo da jornada só carrega em Vitória.

Ranking v1: até três projetos; unidades com estoque explicitamente zero não entram; orçamento elimina preço ausente/acima do limite; prazo imediato exige estágio pronto, outros prazos exigem pronto ou data de entrega futura compatível. Entrega não é autorização nem garantia de início da operação. Preferência de bairro vale 3 pontos e estágio 2; desempate por menor preço elegível e path. Objetivo comercial não pontua, pois não existe evidência de renda ou valorização. Sem resultado, não relaxa orçamento ou prazo. Perfil sugerido limita-se ao menor preço no recorte e variedade de plantas; não presume demanda corporativa, padrão premium ou facilidade de operação.

## Identidade, eventos e atribuição

Os links mantêm GCLID, GBRAID, WBRAID, cinco UTMs, visitor_id e session_id. Usam parâmetros da página e, na ausência, a atribuição e identidade atuais do adaptador existente. A jornada não grava nas chaves de aquisição, first touch ou current touch. Perfil e intenção ficam no sessionStorage por session_id, em `ynt_investment_v1_*`; uma nova sessão não herda preferências silenciosamente. Bloqueio de storage permite a experiência na página, mas pode impedir continuidade das preferências entre páginas; nunca bloqueia o formulário de contato existente.

Os eventos `residential_intent_selected`, `investment_intent_selected`, `investment_profile_completed`, `investment_comparison_viewed` e `investment_project_selected` usam o `track` atual (events.metadata), com a mesma identidade, contexto de sessão e ambos os touches. A entrada na landing dedicada registra intenção de investimento. A primeira intenção declarada é preservada, quando houve declaração anterior; não se presume intenção residencial a partir do nome de campanha. O comparador só emite visualização quando entra na área visível. Não há novos sinais automáticos high_intent_buyer, valores de conversão ou alterações de campanhas.

Ads Intelligence continua recebendo seus eventos canônicos atuais (incluindo lead_created). A evolução adicional fica em events.metadata.investment_context e no contexto do lead, para análises futuras da MIA; não muda as projeções, pontuação ou schema atuais. Não alegar que o feed resumido da MIA já oferece filtros de Airbnb: isso é uma integração futura a partir desse histórico.

Preview não inicializa o tracking, não emite os eventos da jornada, não grava preferências e não envia leads. Mantém noindex e canonical público.

## Lead e estudo posterior

O fluxo usa o mesmo /api/portal/lead → /api/lead, visitor_id, session_id e lead_event_id. O backend saneia investment_context em metadata da linha operacional já existente. O payload mantém aquisição, primeiro e atual contato, campanha e click IDs. A mensagem comercial informa intenção, orçamento, prazo, objetivo e projetos comparados. WhatsApp só aparece após success=true e supabase=true; nada abre antes da confirmação operacional.

investment_context v1 reúne intenção inicial/atual, histórico limitado, perfil, projetos comparados, top 3, selecionado e study v1. O estudo contém instantâneo limitado das configurações, preços, vagas e estoque, status documental, premissas, riscos e próximos passos. São dados declarados pelo cliente, que precisam ser reconfirmados antes de uma proposta. Serve de contrato para geração posterior de página protegida ou PDF; não coloca perfil/PII em URL pública. Não implementa acesso público a registros de lead.

Ausência de documentação continua como não verificado. Uma futura indicação confirmada ou divulgação comercial exige fonte explícita e revisão documental; nenhum desses estados é inferido de nome, amenidades ou descrição.

## Validação

`node --test investment-conversion.test.mjs portal-investment.test.mjs portal-performance.test.mjs portal.test.mjs portal-v3.test.mjs` passa (44 testes). Treze testes relevantes do endpoint de lead, incluindo persistência do contexto e falha de armazenamento, passam. Quatro testes antigos de extração de funções no HTML em ai-lead-context.test.js falham também na base c3babfc, pois as funções já não estão inline no index.html. Não são regressões desta alteração.

Publicar núcleo por PR e validar Preview antes do merge; depois atualizar pin imutável e hashes do site público, validar Preview e produção. Rollback: reverter o pin público e reverter o commit do núcleo para o contrato de lead anterior. Nenhuma migração necessária.
