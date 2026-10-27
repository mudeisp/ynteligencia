// Reviewed complementary media. No scraping, runtime discovery or inventory writes.
const PARADISO_SOURCE='https://www.paradisorc.com.br/';
const profiles={
  'orulo-83252':{verified:true,verifiedAt:'2026-10-27',approved:true,
    source:PARADISO_SOURCE,headline:'O que é o paraíso para você?',
    cover:{url:PARADISO_SOURCE+'images/fachada01.jpg',caption:'Arquitetura · perspectiva ilustrada',position:'center',orientation:'portrait',width:1600,height:1455},
    landscape:{url:PARADISO_SOURCE+'images/lazer/02.jpg',caption:'Piscina · perspectiva ilustrada'},
    portrait:{url:PARADISO_SOURCE+'images/lazer/09.jpg',caption:'Espaço de convivência · perspectiva ilustrada'},
    detail:{url:PARADISO_SOURCE+'images/lazer/14.jpg',caption:'Fitness · perspectiva ilustrada'},
    street:{url:PARADISO_SOURCE+'images/fachadarua.jpg',caption:'O encontro do edifício com a rua · perspectiva ilustrada'},
    videoPoster:PARADISO_SOURCE+'images/lazer/01.jpg',
    media:[{title:'Filme do empreendimento',url:'https://www.youtube.com/watch?v=S_6EmQoOQe0',embed:'https://www.youtube.com/embed/S_6EmQoOQe0'},
      {title:'Tour virtual · apartamento de 2 quartos',url:'https://tour.meupasseiovirtual.com/view/uemd5Im0hqf',embed:'https://tour.meupasseiovirtual.com/view/uemd5Im0hqf'}]
  }
};

export function getEditorialSource(token){const record=profiles[token];return record?.verified===true?structuredClone(record):{};}
export function editorialPlanImage(token,plan){
 const record=profiles[token];if(!record?.verified)return plan;
 const override=token==='orulo-83252'?{'54.77':'2q_c09.jpg','56.72':'2q_c07.jpg','58.08':'2q_s05.jpg','64.77':'2q_c04.jpg','65.69':'2q_c05.jpg','66.40':'2q_s10.jpg'}:{};
 const area=/([\d]+[,.][\d]+)\s*m/i.exec(plan.description)?.[1]?.replace(',','.');
 return override[area]?{...plan,image:record.source+'images/planta/'+override[area]}:plan;
}
