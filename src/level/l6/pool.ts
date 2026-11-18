/**
 * LEVEL 6 — pool6's structure look (decks, galleries, stairs, coaming + guard look, wet dock, water surfaces with W6, sea
 * windows, rails + festoon), its lights and groups (`lights_out6`), emergency strips, the slots' paint. STUB (W4a): task
 * D3a fills it (stage 3d §11).
 *
 * Contract: see `tunnels.ts`. pool6 is dressed by two files: this one first, then `dockdress.ts` (both `build`s run).
 */
import type { RoomId6 } from './grey';
import type { RoomDress } from './index';

export const POOL_DRESS: Partial<Record<RoomId6, RoomDress>> = {};
