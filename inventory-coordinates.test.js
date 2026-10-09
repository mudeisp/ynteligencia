const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("path");
const coordinates = require("./inventory-coordinates.js");

const {
  normalizeCoordinates,
  coordinatesFromOruloBuilding,
  coordinatesFromNonstopProperty,
  deactivationPatch
} = coordinates;

function oruloBuilding(address) {
  return {
    id: "74734",
    name: "Nurban Venâncio",
    address
  };
}

test("Órulo válido materializa latitude e longitude", () => {
  const address = {
    area: "Perdizes",
    city: "São Paulo",
    state: "SP",
    street: "Rua Venâncio",
    latitude: -23.539353,
    longitude: -46.679027
  };

  assert.deepEqual(
    coordinatesFromOruloBuilding(oruloBuilding(address)),
    { latitude: -23.539353, longitude: -46.679027 }
  );
});

test("Nonstop GeoJSON válido usa longitude primeiro e latitude depois", () => {
  const property = {
    id: "abc",
    address: {
      area: "Brooklin",
      geo: {
        type: "Point",
        coordinates: [-46.6901, -23.6102]
      }
    },
    condo: {
      address: {
        geo: {
          coordinates: [-46.1, -23.1]
        }
      }
    }
  };

  assert.deepEqual(
    coordinatesFromNonstopProperty(property),
    { latitude: -23.6102, longitude: -46.6901 }
  );
});

test("pares inválidos viram null/null", () => {
  assert.deepEqual(normalizeCoordinates(0, 0), { latitude: null, longitude: null });
  assert.deepEqual(normalizeCoordinates(-23.5, 0), { latitude: null, longitude: null });
  assert.deepEqual(normalizeCoordinates(0, -46.6), { latitude: null, longitude: null });
  assert.deepEqual(normalizeCoordinates(90.0001, -46.6), { latitude: null, longitude: null });
  assert.deepEqual(normalizeCoordinates(-90.0001, -46.6), { latitude: null, longitude: null });
  assert.deepEqual(normalizeCoordinates(-23.5, 180.0001), { latitude: null, longitude: null });
  assert.deepEqual(normalizeCoordinates(-23.5, -180.0001), { latitude: null, longitude: null });
  assert.deepEqual(normalizeCoordinates(null, undefined), { latitude: null, longitude: null });
  assert.deepEqual(normalizeCoordinates(undefined, -46.6), { latitude: null, longitude: null });
  assert.deepEqual(normalizeCoordinates(Number.NaN, -46.6), { latitude: null, longitude: null });
  assert.deepEqual(normalizeCoordinates(-23.5, Number.POSITIVE_INFINITY), { latitude: null, longitude: null });

  assert.deepEqual(
    coordinatesFromNonstopProperty({
      address: { geo: { coordinates: [0, 0] } }
    }),
    { latitude: null, longitude: null }
  );
  assert.deepEqual(
    coordinatesFromNonstopProperty({
      address: { geo: { coordinates: [-46.6, 0] } }
    }),
    { latitude: null, longitude: null }
  );
  assert.deepEqual(
    coordinatesFromNonstopProperty({
      address: { geo: { coordinates: [-46.6] } }
    }),
    { latitude: null, longitude: null }
  );
  assert.deepEqual(
    coordinatesFromNonstopProperty({
      address: { geo: { coordinates: [] } }
    }),
    { latitude: null, longitude: null }
  );
  assert.deepEqual(
    coordinatesFromNonstopProperty({ address: {} }),
    { latitude: null, longitude: null }
  );
  assert.deepEqual(
    coordinatesFromNonstopProperty({
      address: null,
      condo: { address: { geo: { coordinates: [-46.69, -23.61] } } }
    }),
    { latitude: null, longitude: null }
  );
});

test("string numérica válida e limites inclusivos são aceitos", () => {
  assert.deepEqual(
    normalizeCoordinates(" -23.55 ", " -46.66 "),
    { latitude: -23.55, longitude: -46.66 }
  );
  assert.deepEqual(
    normalizeCoordinates(-90, -180),
    { latitude: -90, longitude: -180 }
  );
  assert.deepEqual(
    normalizeCoordinates(90, 180),
    { latitude: 90, longitude: 180 }
  );
  assert.deepEqual(
    coordinatesFromOruloBuilding(oruloBuilding({
      latitude: "-23.539353",
      longitude: "-46.679027"
    })),
    { latitude: -23.539353, longitude: -46.679027 }
  );
});

test("sync usa o endereço do detalhe e o fallback só quando o detalhe não traz eixo", () => {
  const summary = oruloBuilding({
    latitude: -23.5,
    longitude: -46.6
  });

  assert.deepEqual(
    coordinatesFromOruloBuilding({}, summary),
    { latitude: -23.5, longitude: -46.6 }
  );
  assert.deepEqual(
    coordinatesFromOruloBuilding(oruloBuilding({ area: "Perdizes" }), summary),
    { latitude: -23.5, longitude: -46.6 }
  );
  assert.deepEqual(
    coordinatesFromOruloBuilding(oruloBuilding({
      latitude: 0,
      longitude: 0
    }), summary),
    { latitude: null, longitude: null }
  );
});

test("upsert de Órulo e Nonstop grava as colunas e preserva raw_data", async () => {
  const { normalizeBuilding } = await import("./api/orulo-webhook.js");
  const { normalizeProperty } = await import("./api/nonstop-webhook.js");

  const address = {
    area: "Perdizes",
    city: "São Paulo",
    state: "SP",
    street: "Rua Venâncio",
    latitude: "-23.539353",
    longitude: "-46.679027"
  };
  const building = oruloBuilding(address);
  const [oruloRow] = normalizeBuilding({
    building,
    buildingId: building.id,
    typologies: [{ id: "124818", stock: 3, bedrooms: 2, private_area: 80 }],
    galleryImages: ["https://example.test/foto.jpg"]
  });

  assert.equal(oruloRow.latitude, -23.539353);
  assert.equal(oruloRow.longitude, -46.679027);
  assert.equal(oruloRow.raw_data.building.address, address);
  assert.equal(oruloRow.raw_data.source, "orulo");

  const invalidAddress = {
    area: "Pitangueiras",
    city: "Guarujá",
    latitude: 0,
    longitude: 0
  };
  const [invalidRow] = normalizeBuilding({
    building: oruloBuilding(invalidAddress),
    buildingId: "1",
    typologies: [{ id: "2", stock: 1 }],
    galleryImages: []
  });
  assert.equal(invalidRow.latitude, null);
  assert.equal(invalidRow.longitude, null);
  assert.deepEqual(invalidRow.raw_data.building.address, invalidAddress);

  const nonstopAddress = {
    area: "Brooklin",
    city: "São Paulo",
    state: "SP",
    geo: {
      type: "Point",
      coordinates: [-46.6901, -23.6102, 760]
    }
  };
  const condo = {
    name: "Flórida",
    address: {
      geo: {
        coordinates: [0, 0]
      }
    }
  };
  const property = {
    id: "68b9f050d93107c8ad7636ed",
    title: "Flórida",
    address: nonstopAddress,
    condo
  };
  const nonstopRow = normalizeProperty(property);

  assert.equal(nonstopRow.latitude, -23.6102);
  assert.equal(nonstopRow.longitude, -46.6901);
  assert.equal(nonstopRow.external_id, "nonstop:68b9f050d93107c8ad7636ed");
  assert.equal(nonstopRow.raw_data.address, nonstopAddress);
  assert.equal(nonstopRow.raw_data.condo, condo);
  assert.deepEqual(nonstopRow.raw_data.address.geo.coordinates, [-46.6901, -23.6102, 760]);
});

test("PATCH de desativação não envia coordenadas", () => {
  const patch = deactivationPatch(new Date("2026-10-09T12:00:00.000Z"));
  assert.deepEqual(patch, {
    active: false,
    updated_at: "2026-10-09T12:00:00.000Z"
  });
  assert.equal(Object.hasOwn(patch, "latitude"), false);
  assert.equal(Object.hasOwn(patch, "longitude"), false);

  const webhook = fs.readFileSync(path.join(__dirname, "api/orulo-webhook.js"), "utf8");
  const nonstop = fs.readFileSync(path.join(__dirname, "api/nonstop-webhook.js"), "utf8");
  const sync = fs.readFileSync(path.join(__dirname, "api/orulo-sync.js"), "utf8");
  const stale = webhook.slice(
    webhook.indexOf("async function deactivateStaleRows"),
    webhook.indexOf("async function softDeleteBuilding")
  );
  const soft = webhook.slice(
    webhook.indexOf("async function softDeleteBuilding"),
    webhook.indexOf("export default async function handler")
  );
  const deactivate = nonstop.slice(
    nonstop.indexOf("async function deactivateProperty"),
    nonstop.indexOf("function extractProperties")
  );

  for (const source of [stale, soft, deactivate]) {
    assert.match(source, /deactivationPatch\(\)/);
    assert.equal(source.includes("latitude"), false);
    assert.equal(source.includes("longitude"), false);
  }

  assert.match(sync, /coordinatesFromOruloBuilding\(\s*building,\s*buildingSummary\s*\)/);
  assert.match(webhook, /coordinatesFromOruloBuilding\(\s*building\s*\)/);
  assert.match(nonstop, /coordinatesFromNonstopProperty\(\s*property\s*\)/);
});
