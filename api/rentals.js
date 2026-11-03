import { rest } from '../ads-store.js';
import { createRentalHandler } from '../portal/rentals.js';
export default createRentalHandler({request:rest});
