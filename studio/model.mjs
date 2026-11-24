export const dimensions = {
  arquitetura: 'Arquitetura', natureza: 'Natureza e paisagismo', lazer: 'Lazer',
  plantas: 'Plantas', engenharia: 'Engenharia', privacidade: 'Privacidade',
  sustentabilidade: 'Sustentabilidade', localizacao: 'Localização',
  mobilidade: 'Mobilidade', financeiro: 'Inteligência financeira', perfil: 'Adequação ao perfil'
};

export const relationships = {
  principal:'Empreendimento principal', direta:'Concorrência direta', indireta:'Concorrência indireta', referencia:'Referência qualitativa'
};

const text = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const validImage = value => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

export function presentation(input) {
  const properties = (Array.isArray(input?.properties) ? input.properties : []).slice(0, 6).map(item => ({
    id: text(item?.id, 160), name: text(item?.name, 160),
    subtitle: text(item?.subtitle, 180),
    relationship: Object.hasOwn(relationships,item?.relationship) ? item.relationship : '',
    images: (Array.isArray(item?.images) ? item.images : []).slice(0, 45)
      .filter(image => validImage(image?.url))
      .map(image => ({ url: image.url, category: text(image.category, 80), caption: text(image.caption, 180) })),
    facts: (Array.isArray(item?.facts) ? item.facts : []).slice(0, 60)
      .filter(fact => Object.hasOwn(dimensions, fact?.key))
      .map(fact => ({ key: fact.key, value: text(fact.value, 1500), source: text(fact.source, 300) }))
      .filter(fact => fact.value && fact.source)
  })).filter(item => item.id && item.name);
  if (!properties.length || new Set(properties.map(p => p.id)).size !== properties.length ||
      (input.comparison === true && properties.length < 2)) throw new Error('Seleção de empreendimentos inválida.');
  const chapters = (Array.isArray(input.chapters) ? input.chapters : Object.keys(dimensions))
    .filter(key => Object.hasOwn(dimensions, key));
  return {
    comparison: input.comparison === true,
    title: text(input.title, 180) || 'Seleção de imóveis', greeting: text(input.greeting, 100),
    opening: text(input.opening, 2400), verdict: text(input.verdict, 4500),
    consultant: text(input.consultant, 100), whatsapp: text(input.whatsapp, 18).replace(/\D/g, ''),
    chapters: [...new Set(chapters)],
    chapterText: Object.fromEntries(Object.keys(dimensions)
      .map(key=>[key,text(input.chapterText?.[key],4500)]).filter(([,copy])=>copy)),
    weights: Object.fromEntries(Object.keys(dimensions).map(key => [key,
      Math.max(0, Math.min(5, Math.trunc(Number(input.weights?.[key]) || 0)))])),
    properties
  };
}

export function matrix(data) {
  return data.chapters.map(key => ({
    key, label: dimensions[key], cells: data.properties.map(property => property.facts.filter(fact => fact.key === key))
  }));
}

export function priorities(data) {
  return data.chapters.filter(key => Number(data.weights?.[key]) > 0)
    .sort((first,second) => data.weights[second] - data.weights[first])
    .map(key => dimensions[key]);
}
