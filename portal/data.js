import { rest,supabaseConfigured } from '../ads-store.js';
import { readInventory as readSharedInventory } from './inventory.js';
export function readInventory(state,options={}) {
  return readSharedInventory(state,{request:rest,configured:supabaseConfigured,cacheable:!options.request,...options});
}
