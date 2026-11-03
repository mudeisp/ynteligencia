import assert from "node:assert/strict";
import test from "node:test";
import { normalizeRental,fetchRentalDetail } from "./nonstop-rentals.js";

test("normaliza aluguel Nonstop sem alterar identidade de venda", () => {
  const row = normalizeRental({
    id: "abc123",
    base36Id: "xyz",
    availableFor: ["VENDA", "LOCACAO"],
    transactionStatus: "ATIVO",
    values: { sale: 900000, longStay: 4200, condoFee: 850, propertyTax: 210 },
    address: { area: "Brooklin", city: "São Paulo", state: "SP" },
    rooms: 2,
    baths: 2,
    areas: { private: 72 },
    parkingLots: [{ id: 1 }]
  });
  assert.equal(row.external_id, "nonstop:abc123");
  assert.equal(row.rent_price, 4200);
  assert.equal(row.condo_fee, 850);
  assert.equal(row.property_tax, 210);
  assert.equal(row.neighborhood, "Brooklin");
  assert.equal(row.active, true);
  assert.equal(row.raw_data.operation, "LOCACAO");
  assert.equal(row.raw_data.values.sale, 900000);
});

test("imóvel sem aluguel mensal positivo não fica ativo", () => {
  const row = normalizeRental({ id: "no-rent", availableFor: ["LOCACAO"], values: { longStay: null } });
  assert.equal(row.rent_price, null);
  assert.equal(row.active, false);
});

test("imóvel alugado fica inativo", () => {
  const row = normalizeRental({ id: "leased", availableFor: ["LOCACAO"], transactionStatus: "ALUGADO", values: { longStay: 3000 } });
  assert.equal(row.active, false);
});

test('summary parking counts remain numeric, detail media and description are retained',()=>{
  assert.equal(normalizeRental({id:'p',parkingLots:2}).parking_spaces,2);
  const row=normalizeRental({id:'p',media:{images:[{url:'https://example.com/a.jpg'}]},description:'Real description'});
  assert.equal(row.raw_data.images.length,1);assert.equal(row.raw_data.description,'Real description');
});
test('detail enrichment validates provider identity and cannot silently replace media with a failed response',async()=>{
  const card={id:'p',base36Id:'AB123',image:'https://example.com/cover.jpg'};
  const detailed=await fetchRentalDetail(card,'test',async(url,init)=>{assert.match(url,/\/AB123$/);assert.equal(init.headers.Authorization,'Bearer test');return {ok:true,json:async()=>({id:'p',media:{images:[{url:'https://example.com/2.jpg'}]}})};});
  assert.equal(detailed.image,card.image);assert.equal(detailed.media.images.length,1);
  await assert.rejects(fetchRentalDetail(card,'test',async()=>({ok:false,status:503})),/indisponível/);
  await assert.rejects(fetchRentalDetail(card,'test',async()=>({ok:true,json:async()=>({id:'other'})})),/divergente/);
});
