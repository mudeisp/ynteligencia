import assert from 'node:assert/strict';
import { parseArgs, groupRowsByBuilding, mediaSnapshot, enrichRawData } from './orulo-media-recovery.mjs';

{
  const args = parseArgs(['--states=sp,ES,sp', '--limit=25']);
  assert.deepEqual(args.states, ['SP', 'ES']);
  assert.equal(args.limit, 25);
  assert.equal(args.write, false);
}

{
  const args = parseArgs(['--states=SP', '--write']);
  assert.deepEqual(args.states, ['SP']);
  assert.equal(args.write, true);
}

{
  const grouped = groupRowsByBuilding([
    { external_id: 'a', raw_data: { building_id: '10' } },
    { external_id: 'b', raw_data: { building: { id: 10 } } },
    { external_id: 'c', raw_data: {} }
  ]);
  assert.equal(grouped.size, 1);
  assert.equal(grouped.get('10').length, 2);
}

{
  const snapshot = mediaSnapshot({
    images: ['https://example.com/a.jpg'],
    building: {
      floor_plans: [
        { id: 1, description: 'Planta A' },
        { id: 2, description: 'Planta B', image_url: 'https://example.com/p.jpg' }
      ],
      videos: [{ url: 'https://vimeo.com/1' }],
      virtual_tour: 'https://example.com/tour'
    }
  });
  assert.deepEqual(snapshot, {
    photos: 1,
    floorPlans: 2,
    floorPlanImages: 1,
    videos: 1,
    virtualTour: true,
    status: 'MEDIA_OK'
  });
}

{
  const snapshot = mediaSnapshot({
    building: {
      floor_plans: [{ id: 'x', description: 'Planta sem imagem' }],
      videos: []
    }
  });
  assert.equal(snapshot.status, 'MEDIA_INCOMPLETE_FLOOR_PLANS');
  assert.equal(snapshot.floorPlanImages, 0);
}

{
  const raw = {
    source: 'orulo',
    building: {
      id: '46939',
      name: 'Mandarim The Legend',
      floor_plans: [{ id: '1483722', description: 'Planta 05 - 3 dorm 114,49m²' }]
    }
  };
  const enriched = enrichRawData(raw, [
    {
      id: '1483722',
      description: 'Planta 05 - 3 dorm 114,49m²',
      image_url: 'https://static.orulo.com.br/example.jpg'
    }
  ]);
  assert.equal(enriched.source, 'orulo');
  assert.equal(enriched.building.name, 'Mandarim The Legend');
  assert.equal(enriched.building.floor_plans.length, 1);
  assert.equal(enriched.building.floor_plans[0].image_url, 'https://static.orulo.com.br/example.jpg');
}

console.log('orulo-media-recovery tests: ok');
