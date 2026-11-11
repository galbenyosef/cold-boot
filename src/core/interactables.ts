import * as THREE from 'three';
import type { EventBus, Interactable, InteractableRegistry } from './types';

export function createInteractables(events: EventBus): InteractableRegistry {
  const list: Interactable[] = [];
  const to = new THREE.Vector3();
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
    pick(eye, forward) {
      let best: Interactable | null = null;
      let bestScore = -Infinity;
      for (const i of list) {
        if (!i.enabled) continue;
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
    use(i) {
      if (!i.enabled) return;
      events.emit('interact', { id: i.id, kind: i.kind, position: i.position });
      i.onUse?.();
    },
  };
}
