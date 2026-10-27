import coreHandler from '../lib/orulo-sync-core.js';
import { withOruloFloorPlans } from '../orulo-floor-plans-runtime.js';

export default async function handler(req, res) {
  return withOruloFloorPlans(() => coreHandler(req, res));
}
