# APP + AGENTE: UX coordenada da ficha de imóvel

Este PR muda apresentação. Base APP main fdd7b9fb233fbfa695bf1f520a8a27bec9e810c9; frontend idêntico ao Production 9d8c80cde0405c29d1df07f83f3ccb945e2ad5d4. Par: mudeisp/agente.yincorp, branch ux-property-journey-v1.

- Cards: foto, bairro, nome, preço, área/dormitórios/vagas, VER IMÓVEL. O score continua nos dados e eventos; não é renderizado.
- Ficha universal: galeria existente, resumo legível e um rodapé contextual pertencente ao modal. Dados complementares e atendimento humano ficam abaixo. Não há bloco de MATCH nem disputa IA/especialista.
- APP: QUERO SABER MAIS chama openAgentConversation com o mesmo objeto de imóvel e contrato nativo existente. Flag desabilitada/erro mantém o fallback existente.
- AGENTE atualizado: link na mesma aba, com agent_return=1. VOLTAR À CONVERSA salta a entrada local do modal e a entrada APP no histórico quando o referrer é o AGENTE canônico. Se não houver histórico confiável, navega para o AGENTE canônico na mesma aba, preservando parâmetros de atribuição existentes. Não cria token de handoff nem IDs. A sessão original do AGENTE permanece no sessionStorage dessa aba.
- A marca é somente contexto visual de navegação; não autentica nem substitui visitor/session/source_product. Links antigos que abrem nova aba não oferecem a mesma garantia de retorno: testar o par dos dois PRs.
- O fechamento para catálogo continua registrando property_close/catalog_return. Retorno ao AGENTE registra close_method=agent_return no mesmo property_close, sem fabricar catalog_return. Não foram criados eventos duplicados. property_view conserva inclusive match_score interno. Galeria, plantas, mapa, similares e projeções existentes permanecem.
- A hidratação tardia do empreendimento não reinsere botões IA/humano concorrentes: o rodapé contextual e o atendimento secundário continuam sendo os únicos desses tipos. Book, tabela, vídeo, plantas e seus eventos ficam preservados.
- O score foi retirado apenas do texto de WhatsApp visível ao comprador. Campos internos de lead, notificação comercial, API e CRM permanecem idênticos.
- Sem mudanças em busca, seleção, contagens, scoring, inventário/rawData, sincronização, Ads, leads, atribuição, IA, Push/PWA ou banco. Sem gravação/transcrição/áudio.

## Validação

`node --test property-detail-journey.test.js` exercita renderização real de card/modal em VM e navegação: orgânico/pago, dados escapados, score invisível sem mutação, CTA APP com imóvel original, CTA AGENTE sem handoff, proteção do destino e conservação dos campos de tracking.

Os testes antigos ai-result-cards e agent-property-handoff procuravam funções inline em index.html, embora Production já use scripts delivery/lazy. As falhas foram reproduzidas na base main. Seus fixtures agora leem os mesmos scripts locais carregados pelo HTML, sem executar boot nem acessar rede; o binding foi atualizado para o CTA contextual solicitado. Os testes continuam cobrindo identidades, atribuição, timeouts, popup, validação e round-trip do contrato. Resultado conjunto: 39/39 PASS. O APP é estático, sem package.json/build/typecheck configurados; sintaxe dos scripts alterados e build do Preview verificados.

Revisar em 360/390/412px e desktop: catálogo/count, modal, ESC/Tab, foto/planta/mapa/similares, fechamento/scroll/Voltar, CTA e sessão. As URLs canônicas do handoff e /ficha continuam apontando Production; não relaxar allowlists para fazer um Preview parecer um teste integrado. Não executar lead/contato real na QA.

O layout do composer do AGENTE fica extensível para futura ação FALE SUA PERGUNTA, mantendo digitação. Áudio exige auditoria e PR próprio.

Somente Preview. Sem merge ou deploy Production.
