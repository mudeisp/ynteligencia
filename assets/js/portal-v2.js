const config=JSON.parse(document.getElementById('portal-data')?.textContent||'{}');
const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href='/assets/css/portal-v2.css';document.head.append(stylesheet);
const esc=value=>String(value??'');
const addText=(parent,tag,text,className)=>{const el=document.createElement(tag);if(className)el.className=className;el.textContent=text;parent.append(el);return el;};

const VITORIA_IMAGE='https://commons.wikimedia.org/wiki/Special:Redirect/file/Praia%20de%20Camburi%20-%20Vit%C3%B3ria-ES%20-%20panoramio%20(84).jpg';
function enhanceVitoria(){
  if(location.pathname!=='/es/vitoria')return;
  document.querySelector('.portal-hero')?.classList.add('vitoria-hero');
  const h1=document.querySelector('.portal-hero h1');if(h1)h1.textContent='Imóveis e lançamentos em Vitória, Espírito Santo.';
  const desc=document.querySelector('.hero-description');if(desc)desc.textContent='Explore bairros, empreendimentos e diferentes formas de viver na capital capixaba.';
  const art=document.querySelector('.hero-art');if(art){art.classList.add('city-photo');art.style.backgroundImage=`url("${VITORIA_IMAGE}")`;const label=art.querySelector('.art-label');if(label)label.textContent='VITÓRIA · CAPITAL CAPIXABA · ORLA, ILHAS E BAÍA';}
  const catalog=document.querySelector('.catalog-section');if(!catalog)return;
  const story=document.createElement('section');story.className='city-story';
  const photo=document.createElement('div');photo.className='city-story-photo';photo.style.backgroundImage=`url("${VITORIA_IMAGE}")`;
  const copy=document.createElement('div');copy.className='city-story-copy';addText(copy,'p','VIVER EM VITÓRIA','eyebrow');addText(copy,'h2','Uma capital entre o mar, a baía e a vida urbana.');
  addText(copy,'p','Vitória reúne ilhas, enseadas, manguezais e praias em um território urbano compacto. A cidade foi fundada em 1551 e hoje combina bairros residenciais, centros de negócios, gastronomia e uma forte relação com a orla.');
  const facts=document.createElement('div');facts.className='city-facts';for(const [big,label] of [['1551','fundação oficial'],['46','empreendimentos no catálogo atual'],['Praia do Canto','um dos polos gastronômicos da cidade']]){const item=document.createElement('div');item.className='city-fact';addText(item,'strong',big);addText(item,'span',label);facts.append(item);}copy.append(facts);
  const source=document.createElement('a');source.className='city-source';source.href='https://www.vitoria.es.gov.br/turista/saiba-mais-sobre-vitoria';source.target='_blank';source.rel='noopener noreferrer';source.textContent='Fonte editorial: Prefeitura de Vitória ↗';copy.append(source);story.append(photo,copy);catalog.before(story);
}

function value(v){return v===null||v===undefined||v===''?'—':String(v)}
function richCell(grid,label,val){if(val===null||val===undefined||val==='')return;const cell=document.createElement('div');cell.className='rich-cell';addText(cell,'small',label);addText(cell,'strong',String(val));grid.append(cell);}
async function enhanceProject(){
  const project=config.project;if(!project?.token?.startsWith('orulo-'))return;
  let response;try{response=await fetch(`/api/portal-project-data?token=${encodeURIComponent(project.token)}`);}catch{return;}if(!response?.ok)return;
  const data=await response.json().catch(()=>null);if(!data?.building)return;const b=data.building,t=data.typology||{};
  const overview=document.querySelector('.overview');if(!overview)return;
  const section=document.createElement('section');section.className='rich-orulo';addText(section,'p','FICHA TÉCNICA COMPLETA','eyebrow');addText(section,'h2','Detalhes do empreendimento');
  if(b.address){const a=b.address;const address=[a.street_type,a.street,a.number].filter(Boolean).join(' ');addText(section,'p',[address,a.area,a.city&&a.state?`${a.city}/${a.state}`:a.city,a.zip_code?`CEP ${a.zip_code}`:''].filter(Boolean).join(' · '));}
  const grid=document.createElement('div');grid.className='rich-grid';richCell(grid,'Estágio',b.stage);richCell(grid,'Finalidade',b.finality);richCell(grid,'Incorporadora',b.developer);richCell(grid,'Estoque informado',b.stock);richCell(grid,'Unidades totais',b.total_units);richCell(grid,'Torres',b.number_of_towers);richCell(grid,'Andares',b.number_of_floors);richCell(grid,'Apartamentos por andar',b.apts_per_floor);richCell(grid,'Lançamento',b.launch_date);richCell(grid,'Previsão de entrega',b.opening_date);richCell(grid,'Suítes',t.suites);richCell(grid,'Banheiros',t.bathrooms);section.append(grid);
  if(b.features?.length){addText(section,'h3','Lazer e comodidades');const amenities=document.createElement('div');amenities.className='amenities';for(const name of b.features){addText(amenities,'span',name,'amenity');}section.append(amenities);}
  if(b.floor_plans?.length){addText(section,'h3','Plantas cadastradas na Órulo');const plans=document.createElement('div');plans.className='floor-plans-preview';for(const plan of b.floor_plans.slice(0,12)){addText(plans,'div',plan.description||plan.type||'Planta','floor-plan-item');}section.append(plans);}
  const note=document.createElement('p');note.className='source-note';note.append(document.createTextNode('Dados técnicos carregados do inventário integrado à Órulo. '));if(b.orulo_url){const a=document.createElement('a');a.href=b.orulo_url;a.target='_blank';a.rel='noopener noreferrer';a.textContent='Ver referência na Órulo ↗';note.append(a);}section.append(note);overview.after(section);
}

enhanceVitoria();void enhanceProject();
