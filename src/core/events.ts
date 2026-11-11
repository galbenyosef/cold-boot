import type { EventBus, GameEvents } from './types';

export function createEvents(): EventBus {
  const map = new Map<string, Set<(e: any) => void>>();
  const bus: EventBus = {
    on(type, handler) {
      let set = map.get(type);
      if (!set) map.set(type, (set = new Set()));
      set.add(handler as any);
      return () => set!.delete(handler as any);
    },
    once(type, handler) {
      const off = bus.on(type, (e) => {
        off();
        handler(e);
      });
      return off;
    },
    emit<K extends keyof GameEvents>(type: K, e: GameEvents[K]) {
      const set = map.get(type);
      if (!set) return;
      for (const h of [...set]) {
        try {
          h(e);
        } catch (err) {
          console.error(`[events] handler for "${type}" threw`, err);
        }
      }
    },
  };
  return bus;
}
