import * as THREE from 'three';
import type { EventBus, Interactable, InteractableRegistry } from './types';

/** The level's named regions (`Level.regions`), read lazily: the registry exists before the level is built. */
export type RegionSource = () => Readonly<Record<string, readonly THREE.Box3[]>> | undefined;

/**
 * `regions` (stage 3d §8.5, S8g): where `Interactable.requireRegion` ids are looked up — main.ts passes
 * `() => ctx.level?.regions`. Without it every `requireRegion` interactable is unusable.
 */
export function createInteractables(events: EventBus, regions?: RegionSource): InteractableRegistry {
  const list: Interactable[] = [];
  const to = new THREE.Vector3();
  const probe = new THREE.Vector3();
  const warned = new Set<string>();

  function allowedAt(i: Interactable, feet: THREE.Vector3): boolean {
    const id = i.requireRegion;
    if (!id) return true;
    const boxes = regions?.()?.[id];
    if (!boxes) {
      if (!warned.has(id)) { warned.add(id); console.warn(`[interactables] ${i.id}: unknown region '${id}' (never usable)`); }
      return false;
    }
    probe.set(feet.x, feet.y + 0.05, feet.z);
    for (const b of boxes) if (b.containsPoint(probe)) return true;
    return false;
  }

  return {
    get all() { return list; },
    add(i) {
      const existing = list.findIndex((x) => x.id === i.id);
      if (existing >= 0) list.splice(existing, 1);
      list.push(i);
      return i;
    },
    remove(id) {
      const k = list.findIndex((x) => x.id === id);
      if (k >= 0) list.splice(k, 1);
    },
    get: (id) => list.find((x) => x.id === id),
    pick(eye, forward, feet) {
      let best: Interactable | null = null;
      let bestScore = -Infinity;
      for (const i of list) {
        if (!i.enabled) continue;
        if (i.requireRegion && (!feet || !allowedAt(i, feet))) continue;
        to.copy(i.position).sub(eye);
        const d = to.length();
        const r = i.radius ?? 2.2;
        if (d > r) continue;
        const dot = d < 0.001 ? 1 : to.dot(forward) / d;
        // Wider cone when very close so things at your feet / on desks are easy to hit.
        const minDot = d < 0.9 ? 0.6 : 0.9;
        if (dot < minDot) continue;
        const score = dot * 2 - d / r;
        if (score > bestScore) { bestScore = score; best = i; }
      }
      return best;
    },
    allowedAt,
    use(i) {
      if (!i.enabled) return;
      events.emit('interact', { id: i.id, kind: i.kind, position: i.position });
      i.onUse?.();
    },
  };
}
