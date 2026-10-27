import test from 'node:test';
import assert from 'node:assert/strict';
import { groupRowsByBuilding, enrichRawData } from './backfill-orulo-floor-plans.mjs';

test('groupRowsByBuilding groups only rows with building_id', () => {
  const grouped = groupRowsByBuilding([
    { external_id: 'a', raw_data: { building_id: '10' } },
    { external_id: 'b', raw_data: { building_id: 10 } },
    { external_id: 'c', raw_data: { building_id: '11' } },
    { external_id: 'd', raw_data: {} }
  ]);
  assert.equal(grouped.size, 2);
  assert.equal(grouped.get('10').length, 2);
  assert.equal(grouped.get('11').length, 1);
});

test('enrichRawData changes only building.floor_plans and preserves the rest', () => {
  const raw = {
    source: 'orulo',
    building_id: '66878',
    typology: { id: 1, bedrooms: 2 },
    building: {
      name: 'Youniverse Studios',
      floor_plans: [{ id: 7, description: 'Studio 39m²' }],
      videos: [{ url: 'https://youtube.com/watch?v=test' }]
    }
  };
  const next = enrichRawData(raw, [
    { id: 7, image_url: 'https://cdn.example/plan.jpg', '1024x1024': 'https://cdn.example/plan.jpg' }
  ]);
  assert.equal(next.source, 'orulo');
  assert.deepEqual(next.typology, raw.typology);
  assert.deepEqual(next.building.videos, raw.building.videos);
  assert.equal(next.building.name, 'Youniverse Studios');
  assert.equal(next.building.floor_plans[0].description, 'Studio 39m²');
  assert.equal(next.building.floor_plans[0].image_url, 'https://cdn.example/plan.jpg');
});
