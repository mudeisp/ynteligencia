import { readInventory } from './data.js';
import { createPortalHandler } from './router.js';
export { createPortalHandler,sitemap } from './router.js';
export const handlePortal=createPortalHandler({inventory:readInventory});
