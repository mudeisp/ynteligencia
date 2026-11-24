const figures = (id, entries) => entries.map(([page, category, label]) => ({
  url: `/studio/pilot/${id}-${page}.webp`, category, caption: `${label} · Book, p. ${page}`
}));
const facts = (brand, entries) => entries.map(([key, value, page]) => ({ key, value, source: `${brand}, p. ${page}` }));

export const pilot = {
  title: 'Duas formas de morar perto do verde',
  greeting: 'Mariana',
  opening: 'selecionamos duas propostas para explorar como a planta, o paisagismo e os espaços de bem-estar se encaixam na rotina da sua família.',
  verdict: 'Comece pelo Atypik se a prioridade for uma planta familiar com três suítes e um condomínio de escala menor. Visite o Escape Eden para entender a experiência do complexo e avalie separadamente as plantas de 94 m² e a penthouse de 183 m². Confirme as unidades, o memorial e as condições vigentes antes de decidir.',
  chapters: ['arquitetura','natureza','lazer','plantas','engenharia','privacidade','sustentabilidade','localizacao','financeiro','perfil'],
  consultant: 'Consultoria Yincorp · Cliente fictício',
  properties: [
    {
      id: 'atypik', name: 'Atypik', subtitle: 'Referência principal · residencial de 28 unidades',
      images: figures('atypik', [[5,'Fachada','Perspectiva ilustrada'],[6,'Paisagismo','Jardineiras e caixilhos'],[7,'Acesso','Perspectiva ilustrada'],[9,'Piscina','Perspectiva ilustrada'],[10,'Bem-estar','Fitness e sauna'],[14,'Implantação','Térreo'],[15,'Implantação','Segundo pavimento'],[16,'Plantas','Manacá, 201 m²'],[18,'Plantas','Jacarandá e Aroeira'],[19,'Plantas','Ipê e Haus'],[20,'Plantas','Penthaus duplex']]),
      facts: facts('Book Atypik', [
        ['arquitetura','Concreto aparente, grandes caixilhos e jardineiras lineares na composição da fachada.',5],
        ['natureza','Jardineiras com espécies nativas e irrigação automática descritas no book.',6],
        ['lazer','Piscinas adulto e infantil e quadra de beach tennis nas perspectivas do lazer.',9],
        ['lazer','Fitness com varanda integrada, spa lounge e sauna seca anunciados.',10],
        ['plantas','Manacá de 201 m² com três suítes com closet e três ou quatro vagas determinadas. A planta indica terraço técnico.',16],
        ['plantas','O book apresenta alternativas de configuração e Penthaus duplex de 394 m² com quatro vagas determinadas.',20],
        ['engenharia','Previsão de instalação de ar-condicionado nos apartamentos. O book especifica entrega de ar-condicionado no fitness e no salão de festas.',21],
        ['privacidade','O book informa 28 apartamentos. Descreve hall social privativo e elevador social com biometria.',21],
        ['sustentabilidade','O material cita reúso de água pluvial para irrigação e previsão para futura instalação de aquecimento solar.',21],
        ['localizacao','Rua Comendador Eduardo Saccab, 181.',25],
        ['perfil','A planta de 201 m² com três suítes permite avaliar a separação entre rotina familiar e recepção.',16]
      ])
    },
    {
      id: 'escape-eden', name: 'Escape Eden · Cyrela', subtitle: 'Referência qualitativa · condomínio dentro de um complexo urbano',
      images: figures('escape-eden', [[18,'Fachada','Perspectiva ilustrada'],[8,'Fachada','Fotomontagem'],[9,'Paisagismo','Fotomontagem da fachada e entorno'],[11,'Acesso','Lobby em perspectiva ilustrada'],[14,'Bem-estar','Piscina interna e Escape SPA'],[24,'Piscina','Perspectiva ilustrada'],[25,'Implantação','Térreo'],[26,'Implantação','Lazer'],[30,'Plantas','94 m², planta padrão e opção'],[33,'Plantas','70 m², planta padrão e opção'],[35,'Plantas','76 m², planta padrão e opção'],[36,'Plantas','Penthouse de 183 m²']]),
      facts: facts('Book Escape Eden', [
        ['arquitetura','A fachada e o lobby de pé-direito duplo são apresentados em perspectivas ilustradas.',11],
        ['natureza','O book descreve área superior a 40 mil m² e um parque no conjunto urbano de seis quarteirões. A área indicada é do complexo.',6],
        ['lazer','A implantação indica Escape SPA, piscina interna, sauna e piscina externa.',26],
        ['plantas','O book apresenta plantas residenciais de 50, 70, 74, 76 e 94 m², além de penthouse de 183 m². O material também apresenta studios em seção própria.', '27–41'],
        ['engenharia','Na planta de 94 m² do final 5, o book indica infraestrutura para ar-condicionado na sala, terraço e dormitórios e misturadores entregues em banhos e cozinha.',30],
        ['privacidade','A implantação térrea distingue lobby, entrada de serviço, garagem e portaria. O book apresenta o Private Pool House como ambiente ilustrado.', '22, 25'],
        ['perfil','A unidade de 94 m² tem uma opção de configuração no book. A penthouse de 183 m² é uma planta de duas suítes e terraço descoberto.', '30, 36']
      ])
    }
  ]
};
