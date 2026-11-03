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


{
  const args = parseArgs(['--states=SP', '--building-id=46939']);
  assert.equal(args.buildingId, '46939');
  assert.equal(args.write, false);
  assert.equal(parseArgs(['--building-id=46939', '--write']).write, true);
  assert.equal(parseArgs([]).buildingId, null);
  for (const argv of [
    ['--building-id='], ['--building-id'], ['--building-id=abc'],
    ['--building-id=0'], ['--building-id=-1'], ['--building-id=46939=other'],
    ['--building-id=46939', '--building-id=10']
  ]) assert.throws(() => parseArgs(argv), /BUILDING_ID_INVALID/);
}

// Load a separate module instance with fake credentials; every HTTP call is mocked.
{
  const keys = ['ORULO_CLIENT_ID', 'ORULO_CLIENT_SECRET', 'SUPABASE_SECRET_KEY'];
  const saved = keys.map((key) => process.env[key]);
  let runRecovery;
  try {
    for (const key of keys) process.env[key] = 'test-only';
    ({ runRecovery } = await import('./orulo-media-recovery.mjs?single-building-test'));
  } finally {
    keys.forEach((key, i) => {
      if (saved[i] === undefined) delete process.env[key];
      else process.env[key] = saved[i];
    });
  }
  const rows = [
    { external_id: 'other', raw_data: { building_id: '10', building: { floor_plans: [{ id: 'p' }] } } },
    { external_id: 'mandarim-a', raw_data: { building_id: 46939, building: { floor_plans: [{ id: 'p' }] } } },
    { external_id: 'mandarim-b', raw_data: { building: { id: '46939', floor_plans: [{ id: 'p' }] } } }
  ];
  for (const write of [false, true]) {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      if (url === 'https://www.orulo.com.br/oauth/token') {
        return { ok: true, json: async () => ({ access_token: 'test-only' }) };
      }
      if (options.method === 'PATCH') return { ok: true };
      if (url.includes('/rest/v1/properties?')) return { ok: true, json: async () => rows };
      assert.match(url, /\/buildings\/46939\/floor_plans\?/);
      return { ok: true, json: async () => ({ floor_plans: [{ id: 'p', '1024x1024': 'https://example.com/plan.jpg' }] }) };
    };
    const args = parseArgs(['--states=SP', '--building-id=46939', '--limit=1', ...(write ? ['--write'] : [])]);
    const summary = await runRecovery({ args, fetchImpl });
    assert.equal(summary.buildingId, '46939');
    assert.equal(summary.buildings, 1);
    assert.equal(summary.rows, 2);
    assert.equal(summary.buildingsRecoverable, 1);
    assert.equal(summary.planImagesReturnedLive, 1);
    assert.equal(summary.rowsChanged, 2);
    assert.equal(summary.rowsWritten, write ? 2 : 0);
    assert.deepEqual(summary.failures, []);
    assert.deepEqual(summary.recoverable.map((item) => item.buildingId), ['46939']);
    const patches = calls.filter(({ options }) => options.method === 'PATCH');
    assert.deepEqual(patches.map(({ url }) => new URL(url).searchParams.get('external_id')), write ? ['eq.mandarim-a', 'eq.mandarim-b'] : []);
    for (const { options } of patches) {
      assert.equal(JSON.parse(options.body).raw_data.building.floor_plans[0].image_url, 'https://example.com/plan.jpg');
    }
  }
  const fetchImpl = async (url) => {
    if (url.endsWith('/oauth/token')) return { ok: true, json: async () => ({ access_token: 'test-only' }) };
    assert.ok(url.includes('/rest/v1/properties?'));
    return { ok: true, json: async () => rows };
  };
  await assert.rejects(runRecovery({ args: parseArgs(['--building-id=999']), fetchImpl }), /BUILDING_ID_NOT_FOUND/);
  await assert.rejects(runRecovery({
    args: { states: ['SP'], buildingId: '', write: true },
    fetchImpl: () => assert.fail('Invalid ID must fail before any HTTP call')
  }), /BUILDING_ID_INVALID/);
}

console.log('orulo-media-recovery tests: ok');
