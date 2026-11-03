const SUPABASE_URL = process.env.SUPABASE_URL || "https://wzaegidwtdjuhqchpdpd.supabase.co";
const NONSTOP_BASE_URL = "https://www.usenonstop.com/api/unstable/imoveis/todos";
const PER_PAGE = 50;

function clean(value) { return String(value ?? "").trim(); }
function num(value) { if (value === null || value === undefined || value === '') return null; const n = Number(value); return Number.isFinite(n) ? n : null; }
function arr(value) { return Array.isArray(value) ? value : []; }

function imageUrl(property) {
  const candidates = [property?.image, property?.media?.images?.[0]?.url, property?.media?.images?.[0], property?.images?.[0]?.url, property?.images?.[0]];
  return candidates.map(clean).find(Boolean) || null;
}

function coordinates(property) {
  const lat = num(property?.address?.latitude ?? property?.latitude ?? property?.location?.lat ?? property?.address?.geo?.coordinates?.[1]);
  const lng = num(property?.address?.longitude ?? property?.longitude ?? property?.location?.lng ?? property?.address?.geo?.coordinates?.[0]);
  return { latitude: lat, longitude: lng };
}

export function normalizeRental(property) {
  const id = clean(property?.id || property?._id || property?.base36Id || property?.code);
  if (!id) throw new Error("Imóvel Nonstop sem ID");
  const address = property?.address || {};
  const availableFor = arr(property?.availableFor);
  const status = clean(property?.transactionStatus).toUpperCase();
  const rentPrice = num(property?.values?.longStay ?? property?.rentPrice ?? property?.rentalPrice ?? null);
  const condoFee = num(property?.values?.condoFee ?? property?.fees?.condo ?? property?.condoFee ?? null);
  const propertyTax = num(property?.values?.propertyTax ?? property?.fees?.propertyTax ?? property?.propertyTax ?? null);
  const privateArea = num(property?.areas?.private ?? property?.privateArea ?? property?.area ?? null);
  const totalArea = num(property?.areas?.total ?? property?.totalArea ?? null);
  const parkingSpaces = Array.isArray(property?.parkingLots) ? property.parkingLots.length : num(property?.parkingLots ?? property?.parkingSpaces ?? property?.parking ?? null);
  const base36Id = clean(property?.base36Id);
  const active = !availableFor.includes("INDISPONIVEL") && !["VENDIDO", "ALUGADO", "INATIVO"].includes(status) && rentPrice !== null && rentPrice > 0;
  return {
    external_id: `nonstop:${id}`,
    source: "nonstop",
    title: clean(property?.title || property?.name || `Imóvel para alugar em ${address?.area || address?.neighborhood || "São Paulo"}`),
    development_name: clean(property?.condo?.name || property?.condominium?.name) || null,
    neighborhood: clean(address?.area || address?.neighborhood || property?.neighborhood) || null,
    city: clean(address?.city || property?.city) || null,
    state: clean(address?.state || property?.state) || null,
    rent_price: rentPrice,
    condo_fee: condoFee,
    property_tax: propertyTax,
    bedrooms: num(property?.rooms ?? property?.bedrooms ?? property?.dormitories ?? null),
    bathrooms: num(property?.baths ?? property?.bathrooms ?? null),
    parking_spaces: parkingSpaces,
    area: privateArea ?? totalArea,
    image_url: imageUrl(property),
    property_url: base36Id ? `https://www.usenonstop.com/imovel/${encodeURIComponent(base36Id)}` : clean(property?.url) || null,
    ...coordinates(property),
    active,
    raw_data: { source: "nonstop", operation: "LOCACAO", nonstop_id: id, available_for: availableFor, values: property?.values ?? {}, fees: property?.fees ?? {}, address: property?.address ?? {}, areas: property?.areas ?? {}, type: property?.type ?? null, transaction_status: property?.transactionStatus ?? null, description: property?.description ?? "", images: property?.media?.images ?? property?.images ?? [], provider_updated_at: property?.updatedAt ?? null },
    updated_at: new Date().toISOString()
  };
}

function headers(key, prefer) {
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  if (prefer) h.Prefer = prefer;
  return h;
}

async function fetchPage(token, page, perPage = PER_PAGE) {
  const params = new URLSearchParams({ currentPage: String(page), perPage: String(perPage), availableFor: "LOCACAO" });
  const response = await fetch(`${NONSTOP_BASE_URL}?${params}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Nonstop ${response.status}: ${text.slice(0, 1000)}`);
  const data = JSON.parse(text);
  const properties = data?.data?.properties ?? data?.properties ?? data?.data ?? [];
  const total = num(data?.data?.total ?? data?.total ?? data?.totalItems ?? data?.pagination?.total);
  return { properties: Array.isArray(properties) ? properties : [], total, raw: data };
}

export async function fetchRentalDetail(card,token,request=fetch){
  const code=clean(card.base36Id);
  if(!/^[a-z0-9]+$/i.test(code))throw Error('Código Nonstop inválido');
  const response=await request(`https://www.usenonstop.com/api/unstable/imoveis/${code}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw Error(`Detalhe Nonstop indisponível (${response.status})`);
  const detail=await response.json();
  if(clean(detail.id)!==clean(card.id))throw Error('Identidade Nonstop divergente');
  // A failed detail never overwrites previously enriched media with a summary card.
  return {...card,...detail,image:card.image};
}

async function upsert(rows, key) {
  if (!rows.length) return 0;
  const response = await fetch(`${SUPABASE_URL}/rest/v1/rental_properties?on_conflict=external_id`, { method: "POST", headers: headers(key, "resolution=merge-duplicates,return=minimal"), body: JSON.stringify(rows) });
  const text = await response.text();
  if (!response.ok) throw new Error(`Supabase ${response.status}: ${text.slice(0, 1500)}`);
  return rows.length;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
  const token = process.env.NONSTOP_API_TOKEN;
  res.setHeader('Cache-Control', 'no-store');
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!token) return res.status(500).json({ ok: false, error: "NONSTOP_API_TOKEN não configurado" });
  const action = clean(req.query?.action || "debug").toLowerCase();
  const page = Math.max(1, Number.parseInt(req.query?.page || "1", 10) || 1);
  const pages = Math.min(20, Math.max(1, Number.parseInt(req.query?.pages || "1", 10) || 1));
  try {
    if (action === "envcheck") return res.status(200).json({ ok: true, operation: "LOCACAO", nonstop_token: true, supabase_service_role: Boolean(supabaseKey) });
    if (action === "debug") {
      const result = await fetchPage(token, page);
      const normalized = result.properties.slice(0, 3).map(normalizeRental);
      return res.status(200).json({ ok: true, operation: "LOCACAO", page, detected_total: result.total, received: result.properties.length, sample: normalized.map(({raw_data,...row})=>({...row,raw_data:{operation:'LOCACAO',values:raw_data.values}})) });
    }
    if (action !== "sync") return res.status(400).json({ ok: false, error: "action inválida" });
    if (!process.env.MIA_READ_TOKEN || req.headers?.authorization !== `Bearer ${process.env.MIA_READ_TOKEN}`) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    if (!supabaseKey) return res.status(500).json({ ok: false, error: "SUPABASE_SERVICE_ROLE_KEY não configurada" });
    let saved = 0; let received = 0; let detectedTotal = null;
    for (let p = page; p < page + pages; p += 1) {
      const result = await fetchPage(token, p);
      if (detectedTotal === null) detectedTotal = result.total;
      received += result.properties.length;
      const rows=[];
      for(let i=0;i<result.properties.length;i+=5){
        const detailed=await Promise.all(result.properties.slice(i,i+5).map(card=>fetchRentalDetail(card,token)));
        rows.push(...detailed.map(normalizeRental).filter(row=>row.rent_price!==null && row.rent_price>0));
      }
      saved += await upsert(rows, supabaseKey);
      if (result.properties.length < PER_PAGE) break;
    }
    return res.status(200).json({ ok: true, operation: "LOCACAO", start_page: page, pages, detected_total: detectedTotal, received, saved });
  } catch (error) {
    return res.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
