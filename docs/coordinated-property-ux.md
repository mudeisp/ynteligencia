# APP + AGENTE: UX coordenada da ficha de imóvel

Este PR muda apresentação. Base APP main fdd7b9fb233fbfa695bf1f520a8a27bec9e810c9; frontend idêntico ao Production 9d8c80cde0405c29d1df07f83f3ccb945e2ad5d4. Par: mudeisp/agente.yincorp, branch ux-property-journey-v1.

- Cards: foto, bairro, nome, preço, área/dormitórios/vagas, VER IMÓVEL. O score continua nos dados e eventos; não é renderizado.
- Ficha universal: galeria existente, resumo legível e um rodapé contextual pertencente ao modal. Dados complementares e atendimento humano ficam abaixo. Não há bloco de MATCH nem disputa IA/especialista.
- APP: QUERO SABER MAIS chama openAgentConversation com o mesmo objeto de imóvel e contrato nativo existente. Flag desabilitada/erro mantém o fallback existente.
- AGENTE atualizado: link na mesma aba, com agent_return=1. VOLTAR À CONVERSA salta a entrada local do modal e a entrada APP no histórico quando o referrer é o AGENTE canônico. Se não houver histórico confiável, navega para o AGENTE canônico na mesma aba, preservando parâmetros de atribuição existentes. Não cria token de handoff nem IDs. A sessão original do AGENTE permanece no sessionStorage dessa aba.
- A marca é somente contexto visual de navegação; não autentica nem substitui visitor/session/source_product. Links antigos que abrem nova aba não oferecem a mesma garantia de retorno: testar o par dos dois PRs.
- O fechamento existente continua registrando property_close/catalog_return. Retorno registra close_method=agent_return no mesmo property_close. Não foram criados eventos duplicados. property_view conserva inclusive match_score interno. Galeria, plantas, mapa, similares e projeções existentes permanecem.
- Sem mudanças em busca, seleção, contagens, scoring, inventário/rawData, sincronização, Ads, leads, atribuição, IA, Push/PWA ou banco. Sem gravação/transcrição/áudio.

## Validação

`node --test property-detail-journey.test.js` exercita renderização real de card/modal em VM e navegação: orgânico/pago, dados escapados, score invisível sem mutação, CTA APP com imóvel original, CTA AGENTE sem handoff, proteção do destino e conservação dos campos de tracking.

Testes antigos ai-result-cards e agent-property-handoff ainda procuram funções inline em index.html, embora Production já use scripts delivery/lazy. Falhas reproduzidas na base main sem alterações; não foram ocultadas nem corrigidas incidentalmente. O APP é estático, sem package.json/build/typecheck configurados; validar sintaxe dos scripts alterados e build do Preview.

Revisar em 360/390/412px e desktop: catálogo/count, modal, ESC/Tab, foto/planta/mapa/similares, fechamento/scroll/Voltar, CTA e sessão. As URLs canônicas do handoff e /ficha continuam apontando Production; não relaxar allowlists para fazer um Preview parecer um teste integrado. Não executar lead/contato real na QA.

O layout do composer do AGENTE fica extensível para futura ação FALE SUA PERGUNTA, mantendo digitação. Áudio exige auditoria e PR próprio.

Somente Preview. Sem merge ou deploy Production.
