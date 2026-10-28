import { groupDevelopments, geography, parseRoute, parseFilters, listDevelopments, STATES, slug, html } from './model.js';
import { renderListing, renderDevelopment, renderError } from './render.js';

function origin() {
  const value=process.env.PORTAL_CANONICAL_ORIGIN || 'https://www.yincorp.com.br';
  const url=new URL(value);
  if(url.protocol!=='https:' || !['app.yincorp.com.br','yincorp.com.br','www.yincorp.com.br'].includes(url.hostname) || url.port || url.pathname!=='/' || url.search || url.hash || url.username || url.password) throw new Error('invalid_canonical_origin');
  return url.origin;
}
export function sitemap(groups,base) {
  const paths=new Map();
  for(const state of new Set(groups.map(g=>g.state))) {
    const root=`/${state.toLowerCase()}`, cities=geography(groups,state);
    paths.set(root,null);
    for(const c of cities) {
      paths.set(`${root}/${c.slug}`,null);
      for(const n of c.neighborhoods.values()) paths.set(`${root}/${c.slug}/${n.slug}`,null);
    }
  }
  for(const g of groups) paths.set(g.path,g.updatedAt);
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...paths].map(([path,updated])=>`<url><loc>${html(base+path)}</loc>${updated?`<lastmod>${new Date(updated).toISOString()}</lastmod>`:''}</url>`).join('')}</urlset>`;
}
export function createPortalHandler({inventory,preview=false,canonicalOrigin}={}) {
  return async function portal(req,res) {
    const base=canonicalOrigin || origin();
    const isPreview=preview || process.env.VERCEL_ENV==='preview';
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
    res.setHeader('X-Robots-Tag',isPreview?'noindex, follow':'all');
    if(!['GET','HEAD'].includes(req.method)) {res.setHeader('Allow','GET, HEAD');return res.status(405).end();}
    const url=new URL(req.url || '/',base);
    const path=String(req.query?.portalPath || url.searchParams.get('portalPath') || url.pathname);
    url.searchParams.delete('portalPath');
    const finish=(status,body,type='text/html; charset=utf-8')=>{res.setHeader('Content-Type',type);res.setHeader('Cache-Control',status===200 && !isPreview?'public, max-age=0, s-maxage=60, stale-while-revalidate=120':'no-store');res.status(status);return req.method==='HEAD'?res.end():res.send(body);};
    const redirect=(path)=>{res.setHeader('Cache-Control','no-store');res.setHeader('Location',path);return res.status(308).end();};
    let route;
    try {
      if(path==='/sitemap-portal.xml') {
        const states=[...new Set(String(process.env.PORTAL_SITEMAP_STATES || 'ES,SP').toUpperCase().split(',').map(s=>s.trim()))].filter(s=>STATES[s]);
        const all=(await Promise.all(states.map(s=>inventory(s,{mode:'listing'})))).flat();
        return finish(200,sitemap(groupDevelopments(all),base),'application/xml; charset=utf-8');
      }
      route=parseRoute(path);
      if(!route) return finish(404,renderError(404,{origin:base,preview:isPreview}));
      const listingRows=await inventory(route.state,{mode:'listing'});
      const groups=groupDevelopments(listingRows);
      const cities=geography(groups,route.state);
      const city=cities.find(c=>c.slug===route.city);
      if(!groups.length || (route.city && !city) || (route.neighborhood && !city.neighborhoods.has(route.neighborhood))) return finish(404,renderError(404,{origin:base,preview:isPreview,state:route.state}));
      if(['development','unit'].includes(route.kind)) {
        const lightProject=groups.find(g=>g.state===route.state && slug(g.city)===route.city && g.token===route.token);
        if(!lightProject)return finish(404,renderError(404,{origin:base,preview:isPreview,state:route.state}));
        const detailRows=await inventory(route.state,{mode:'project',ids:lightProject.units.map(u=>u.id)});
        const project=groupDevelopments(detailRows).find(g=>g.token===lightProject.token);
        const unit=route.unitId?project?.units.find(u=>u.id===route.unitId):undefined;
        if(!project || (route.unitId && !unit))return finish(404,renderError(404,{origin:base,preview:isPreview,state:route.state}));
        const target=project.path+(unit?`/tipologia/${unit.id}`:'');
        if(path!==target)return redirect(target+(url.searchParams.size?'?'+url.searchParams:''));
        const related=groups.filter(g=>g.token!==project.token && g.city===project.city && g.state===project.state).sort((a,b)=>Number(b.neighborhood===project.neighborhood)-Number(a.neighborhood===project.neighborhood) || Math.abs((a.price??Infinity)-(project.price??0))-Math.abs((b.price??Infinity)-(project.price??0)) || a.path.localeCompare(b.path)).slice(0,3);
        return finish(200,renderDevelopment({project,route,unit,related,canonical:base+project.path,origin:base,preview:isPreview}));
      }
      const filters=parseFilters(url.searchParams);
      if(url.searchParams.has('cidade') || url.searchParams.has('bairro')) {
        const wantedCity=cities.find(c=>c.slug===filters.city),wantedNeighborhood=wantedCity?.neighborhoods.get(filters.neighborhood);
        if((filters.city && !wantedCity) || (filters.neighborhood && !wantedNeighborhood))return finish(404,renderError(404,{origin:base,preview:isPreview,state:route.state}));
        const target=`/${route.state.toLowerCase()}${wantedCity?'/'+wantedCity.slug:''}${wantedNeighborhood?'/'+wantedNeighborhood.slug:''}`;
        url.searchParams.delete('cidade');url.searchParams.delete('bairro');url.searchParams.delete('pagina');
        for(const [k,v]of [...url.searchParams])if(!v || (k==='ordem' && v==='recentes'))url.searchParams.delete(k);
        return redirect(target+(url.searchParams.size?'?'+url.searchParams:''));
      }
      if(!filters.page)return finish(404,renderError(404,{origin:base,preview:isPreview,state:route.state}));
      const results=listDevelopments(groups,route,filters);
      if(filters.page>results.pages)return finish(404,renderError(404,{origin:base,preview:isPreview,state:route.state}));
      const canonicalParams=new URLSearchParams();
      for(const [k,v]of [['preco',filters.max],['quartos',filters.bedrooms],['q',filters.q],['ordem',filters.sort==='recentes'?'':filters.sort],['pagina',filters.page>1?filters.page:null]])if(v)canonicalParams.set(k,String(v));
      const normalized=`/${route.state.toLowerCase()}${route.city?'/'+route.city:''}${route.neighborhood?'/'+route.neighborhood:''}`;
      if(path!==normalized)return redirect(normalized+(url.searchParams.size?'?'+url.searchParams:''));
      const canonical=base+normalized+(canonicalParams.size?'?'+canonicalParams:'');
      return finish(200,renderListing({route,filters,cities,results,groups,canonical,origin:base,preview:isPreview}));
    }catch(error) {
      console.error('PORTAL_CATALOG_ERROR',error?.message || error?.name || 'Error');
      res.setHeader('Retry-After','60');
      return finish(503,renderError(503,{origin:base,preview:isPreview,state:route?.state || 'ES'}));
    }
  };
}
