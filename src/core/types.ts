/**
 * COLD BOOT — shared contract.
 *
 * Every system is created by a `createX(ctx)` factory in `src/<module>/index.ts` and attached to the
 * GameContext. Systems talk to each other ONLY through the interfaces in this file and the event bus.
 * This file is owned by the coordinator: do not edit it from a module task — if you need a contract
 * change, make it additive in your own module and report it.
 *
 * Units: metres, seconds, radians. Y is up. The level's main floor is y = 0. "Forward" is -Z.
 */
import type * as THREE from 'three';

// ───────────────────────────────────────────────────────────── game state

export type GameState = 'loading' | 'menu' | 'playing' | 'cutscene' | 'paused' | 'dead' | 'ended';

export type Quality = 'low' | 'medium' | 'high' | 'ultra';

/**
 * Which level this page load is running (REVISION 4). One level per page load; changing level reloads.
 * Stage 3a (docs/plans/stage-3a.md §8.1): 1…6 parse; only `LEVELS[id].built` levels boot (core/progress.ts).
 */
export type LevelId = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * Static facts about one level (§8.1). `LEVELS` in core/progress.ts is the ONLY place that knows them; modules
 * look their level up (`levelOf(ctx)`) instead of branching on the level number.
 */
export interface LevelInfo {
  id: LevelId;
  /** Id prefix of this level's lines / files: 'l1', 'l2', … */
  tag: `l${LevelId}`;
  /** Has a level + story implementation (a direct start of an unbuilt level clamps to the highest built one). */
  built: boolean;
  /** Chapter title (end card, menu). */
  title: string;
  /** Short place name: HUD location line, resume gate, menu ("Sublevel 3", "Line Two"). */
  place: string;
  /** Boot overlay status word while the level builds. */
  bootStatus: string;
  /** Header line of terminal screens (materials/screens.ts). */
  screenHeader: string;
  /** Camera label on `camera_feed` screens. */
  camLabel: string;
  /** `terminal_idle` screens show their `text` (level 2+), not only scrolling diagnostics. */
  idleText: boolean;
  /** Audio: the level's bus is powered from load (ambience "power on" without the restore beat). */
  powerOnAtLoad: boolean;
  /** HUD name of a picked-up keycard; null = the generic name ("LOCK-OUT KEY"); prompts name the key when set. */
  keycardName: string | null;
  /** Eyebrow of the end screen; null = the level's own ending text. */
  endEyebrow: string | null;
  /** Menu line under CONTINUE when this is the stored level (null = none). */
  menuLine: string | null;
  /** Subtitles: 'single' = one line at a time (level 1's look), 'stacked' = speakers stack, per-speaker styles. */
  subtitles: 'single' | 'stacked';
  /** Enemy templates the level needs at load (enemies/index.ts). */
  cast: { foreman: boolean; human: boolean; tomasHead: boolean };
  /** Arrival without a carry (direct start / debug URL): loadout and facts (§7). */
  direct: { facts: Facts; loadout: DirectLoadout | null };
  /** A carried health value below this is raised to it on arrival (0 = none). */
  healthFloor: number;
  /** The level the chain hands over to at this level's end; null = the end card + menu (§8.1, D19). */
  next: LevelId | null;
}

/**
 * Loadout for a direct start (§7), applied as pickups: `give(weapon, clip)` then `give(ammo_<weapon>, reserve)` (a
 * weapon pickup fills the clip and adds its amount to the reserve, so 12 + 24 ends as 12 / 36 — as level 2 always did).
 */
export interface DirectLoadout {
  weapons: Partial<Record<WeaponId, { clip: number; reserve: number }>>;
  health: number;
  flashlight: boolean;
}

/**
 * Story facts carried between levels and stored with every checkpoint (§8.1, §7). Level 2's end sets `choice`
 * (`stop` = STOP / shutdown, `command` = COMMAND / rewrite) and `unitsLeft`. Optional because level 1 has none yet.
 */
export interface Facts {
  choice?: 'stop' | 'command';
  unitsLeft?: number;
  [k: string]: string | number | boolean | undefined;
}

/** The loadout + facts one level hands to the next (§8.1). Key `coldboot.carry.v2`. */
export interface CarryV2 {
  v: 2;
  /** The level that wrote it; only valid for `LEVELS[from].next`. */
  from: LevelId;
  health: number;
  /** Armour points (no armour system yet: always 0). */
  armor: number;
  flashlight: boolean;
  current: WeaponId | null;
  /** Full record. On load unknown ids are dropped and missing ones are unowned. */
  weapons: Record<WeaponId, { owned: boolean; clip: number; reserve: number }>;
  facts: Facts;
}

/** One checkpoint (§8.1). Key `coldboot.save.l<N>.v2`; `rev` = the level's story revision; `P` = its progress record. */
export interface SaveV2<P, Id extends string = string> {
  v: 2;
  level: LevelId;
  rev: number;
  id: Id;
  /** Display name of the room the checkpoint was taken in (menu CONTINUE). */
  place: string;
  player: PlayerSave;
  story: P;
  /** Records recovered (ending stat). */
  logs: string[];
  stats: { time: number; kills: number };
  /** Enemy groups to delete on load (all dead at save time). */
  cleared: string[];
  /** `ctx.facts` when the checkpoint was written. */
  facts: Facts;
}

export interface DebugFlags {
  /** ?autostart=1 — skip the menu/intro and go straight to 'playing' (no pointer lock required). */
  autostart: boolean;
  /** ?spawn=x,y,z,yawDeg[,pitchDeg] — override the player spawn. */
  spawn: { position: THREE.Vector3; yaw: number; pitch: number } | null;
  /** ?noenemies=1 — EnemyManager must not spawn anything. */
  noEnemies: boolean;
  /** ?nostory=1 — StorySystem must not run scripted beats (doors all unlocked, lights on defaults). */
  noStory: boolean;
  /** ?god=1 — player takes no damage. */
  god: boolean;
  /** ?give=all — player starts with every weapon and plenty of ammo. */
  giveAll: boolean;
  /** ?quality=low|medium|high|ultra */
  quality: Quality | null;
  /** ?debug=1 — modules may draw helpers / verbose logs. */
  verbose: boolean;
  /** ?level=1…6 — force a level (REVISION 4, §8.1; unbuilt levels clamp to the highest built one); null = use saved progress. */
  level: LevelId | null;
  /** ?choice=stop|command — level 2's choice for a direct start of a later level (§7); null = carry / default. */
  choice: 'stop' | 'command' | null;
  /** ?units=N — `facts.unitsLeft` for a direct start (§7); null = carry / default. */
  units: number | null;
  /** Smoothed frames per second, written by main loop. */
  fps: number;
}

export interface GameContext {
  canvas: HTMLCanvasElement;
  /** Root element for all DOM UI (`#ui`). */
  uiRoot: HTMLElement;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;

  events: EventBus;
  input: Input;
  physics: Physics;
  interactables: InteractableRegistry;

  render: RenderSystem;
  materials: MaterialLibrary;
  fx: FxSystem;
  audio: AudioSystem;
  level: Level;
  player: Player;
  enemies: EnemyManager;
  ui: UISystem;
  story: StorySystem;

  debug: DebugFlags;
  /** The level this page load runs. Set by main.ts before any system is created; never changes. */
  levelId: LevelId;
  /**
   * §8.1: story facts this level was entered with (carry, else `?choice=`/`?units=`, else `LEVELS[id].direct.facts`).
   * Set by main.ts before any system is created, so the level may build per fact (e.g. a screen per choice).
   */
  facts: Readonly<Facts>;
  /** Seconds of simulated (unpaused) game time. */
  time: number;
  state: GameState;
  setState(state: GameState): void;
  /** True once every system is constructed and the first frame was rendered. */
  ready: boolean;
}

/** Common shape of every per-frame system. `dt` is clamped to <= 1/20 s. */
export interface Updatable {
  update(dt: number): void;
}

// ───────────────────────────────────────────────────────────── events

export type Surface = 'metal' | 'concrete' | 'glass' | 'rubber' | 'robot' | 'flesh';
export type WeaponId = 'pistol' | 'shotgun';
/** §8.1: every WeaponId, in slot order. snapshot / restore / carry iterate this list (never hard-coded ids). */
export const WEAPON_IDS: readonly WeaponId[] = ['pistol', 'shotgun'];
export type EnemyType = 'skitter' | 'husk' | 'sentry' | 'foreman';
/** Scripted puppets (enemies.actor) may also be a human (REVISION 4: Tomas). */
export type ActorType = EnemyType | 'human';
export type PickupKind = 'pistol' | 'shotgun' | 'ammo_pistol' | 'ammo_shotgun' | 'medkit' | 'keycard';
export type MusicState = 'silence' | 'ambient' | 'tension' | 'combat' | 'aftermath';

export interface GameEvents {
  'game:state': { state: GameState; prev: GameState };

  /** Player entered / left a level trigger volume (ids listed in docs/DESIGN.md). */
  'trigger:enter': { id: string };
  'trigger:exit': { id: string };

  'door:opening': { id: string; position: THREE.Vector3 };
  'door:closing': { id: string; position: THREE.Vector3 };
  'door:denied': { id: string; position: THREE.Vector3 };

  /** Player pressed "use" on an interactable. */
  'interact': { id: string; kind: string; position: THREE.Vector3 };
  'pickup': { kind: PickupKind; amount: number; position: THREE.Vector3 };

  'player:damaged': { amount: number; health: number; from: THREE.Vector3 | null };
  'player:healed': { amount: number; health: number };
  'player:died': {};
  'player:footstep': { position: THREE.Vector3; surface: Surface; running: boolean };
  'player:jump': {};
  'player:land': { speed: number };
  'player:flashlight': { on: boolean };

  'weapon:fired': { weapon: WeaponId; origin: THREE.Vector3; direction: THREE.Vector3 };
  'weapon:empty': { weapon: WeaponId };
  'weapon:reload': { weapon: WeaponId; duration: number };
  'weapon:switched': { weapon: WeaponId };
  /**
   * A bullet / pellet hit static world geometry. `owner` (REVISION 5.2, optional): set when the ray hit a
   * dynamic box (door leaf, moving / temporary thing) — see HitOwner; absent = static world.
   */
  'bullet:impact': { point: THREE.Vector3; normal: THREE.Vector3; surface: Surface; owner?: HitOwner };

  'enemy:spawned': { id: number; type: EnemyType; position: THREE.Vector3 };
  'enemy:woke': { id: number; type: EnemyType; position: THREE.Vector3 };
  'enemy:alerted': { id: number; type: EnemyType; position: THREE.Vector3 };
  'enemy:attack': { id: number; type: EnemyType; position: THREE.Vector3; kind: 'melee' | 'ranged' };
  'enemy:damaged': { id: number; type: EnemyType; point: THREE.Vector3; direction: THREE.Vector3; amount: number; part?: string };
  /**
   * REVISION 5: a player's shot line passed through a puppet before hitting the world (the enemies module
   * ray-tests its actors on every shot). Holograms react by themselves (tear / collapse); the story may
   * react too. Solid puppets behind glass never get this (the glass stops the ray first).
   */
  'actor:shot': { actor: EnemyActor; type: ActorType; look: ActorLook; point: THREE.Vector3 };
  /** REVISION 4: a destructible part is gone (foreman heads: 'head_a' | 'head_b' | 'head_c'; arms). */
  'enemy:part-destroyed': { id: number; type: EnemyType; part: string; position: THREE.Vector3 };
  'enemy:died': { id: number; type: EnemyType; position: THREE.Vector3; group: string };
  'enemy:step': { id: number; type: EnemyType; position: THREE.Vector3 };
  /** Every enemy of a spawn group is dead. */
  'enemy:group-cleared': { group: string };

  /** Story → UI. */
  'story:objective': { text: string };
  'story:subtitle': { speaker: string; text: string; duration: number };
  'story:log': { id: string; title: string; body: string };
  'story:toast': { text: string };
  /** Story beat marker (ids in docs/DESIGN.md) — audio/fx may react. */
  'story:beat': { id: string };
}

export interface EventBus {
  on<K extends keyof GameEvents>(type: K, handler: (e: GameEvents[K]) => void): () => void;
  once<K extends keyof GameEvents>(type: K, handler: (e: GameEvents[K]) => void): () => void;
  emit<K extends keyof GameEvents>(type: K, e: GameEvents[K]): void;
}

// ───────────────────────────────────────────────────────────── input (core)

export interface Input {
  /** Is a key held? Uses KeyboardEvent.code, e.g. 'KeyW', 'ShiftLeft', 'Space'. */
  down(code: string): boolean;
  /** Was the key pressed during this frame? */
  pressed(code: string): boolean;
  /** Mouse buttons: 0 left, 1 middle, 2 right. */
  mouseDown(button: number): boolean;
  mousePressed(button: number): boolean;
  /** Accumulated mouse movement (pixels) since last frame — zero when pointer is not locked. */
  readonly mouseDX: number;
  readonly mouseDY: number;
  /** Wheel steps this frame (+1 / -1 / 0). */
  readonly wheel: number;
  readonly pointerLocked: boolean;
  requestPointerLock(): void;
  exitPointerLock(): void;
  /** Called by main loop at end of frame. */
  endFrame(): void;
}

// ───────────────────────────────────────────────────────────── physics (core)

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  surface: Surface;
  /** REVISION 5.2: set only when a dynamic box was hit (its resolved `owner`, default 'transient'). */
  owner?: HitOwner;
}

/**
 * REVISION 5.2: what a surface point belongs to, for persistent decals (bullet holes, blood, scorch).
 *  - an Object3D: a moving part (door leaf); a decal placed there is snapped onto its meshes, follows its
 *    world transform, hides while it (or a parent) is hidden and is dropped once it leaves the scene;
 *  - 'transient': something that moves / vanishes with no anchor (wreck boxes, hanging loads, tunnel arms):
 *    impacts there leave no persistent decal (sparks etc. still play).
 */
export type HitOwner = THREE.Object3D | 'transient';

/** A vertical capsule. `position` is the FEET position (bottom of capsule). */
export interface CapsuleBody {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  height: number;
  onGround: boolean;
  /** Default 1. Set 0 for hovering things. */
  gravityScale?: number;
}

export interface DynamicBox {
  box: THREE.Box3;
  enabled: boolean;
  surface: Surface;
  remove(): void;
  /**
   * REVISION 5.2: what this blocker stands for (see HitOwner) — a fixed owner or one resolved per hit point.
   * Unset = 'transient': a dynamic box is by definition something that moves or goes away.
   */
  owner?: HitOwner | ((point: THREE.Vector3) => HitOwner);
  /**
   * A low obstacle a body walks OVER instead of being stopped by (robot wrecks): a capsule touching it whose feet
   * are at most a step (0.55 m) below its top is lifted onto the top. Higher than that, it blocks like any box.
   */
  walkable?: boolean;
}

export interface Physics {
  /**
   * (Re)build the static collision BVH from meshes. Each mesh's world transform is baked.
   * `mesh.userData.surface` (Surface) tags its triangles; default 'metal'.
   */
  build(colliders: THREE.Mesh[]): void;
  /** Closest hit against static world + enabled dynamic boxes, or null. `direction` must be normalised. */
  raycast(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance?: number): RayHit | null;
  /** True when nothing static blocks the segment a→b. */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean;
  /** Integrate gravity + velocity, then depenetrate against world. Mutates body. */
  moveBody(body: CapsuleBody, dt: number): void;
  /** Push a sphere out of the world; returns true if it was touching. Mutates centre. */
  resolveSphere(center: THREE.Vector3, radius: number): boolean;
  /** Axis-aligned dynamic blocker (doors). Toggle `enabled`, or mutate `box` in place. */
  addBox(box: THREE.Box3, surface?: Surface): DynamicBox;
  /**
   * REVISION 5.2: owner of the enabled dynamic box a surface point lies on (within ~1.5 cm), or undefined
   * (static world). Used by decals that do not come from a ray (fluid landing, scorch).
   */
  ownerAt?(point: THREE.Vector3): HitOwner | undefined;
  /**
   * REVISION 5.2: register a moving part whose visible surface coincides with a STATIC collider (a swinging
   * locker door in front of its locker's collider, a drop-down grille, a rattling lift cab). Decals placed
   * within ~4 cm of its meshes follow it. Returns an unregister function.
   */
  addMover?(obj: THREE.Object3D): () => void;
  /** REVISION 5.2: registered movers (see addMover). */
  readonly movers?: readonly THREE.Object3D[];
  readonly gravity: number;
}

// ───────────────────────────────────────────────────────────── interactables (core)

export interface Interactable {
  id: string;
  /** Free-form: 'door' | 'terminal' | 'log' | 'pickup' | 'lever' | 'button' | ... */
  kind: string;
  position: THREE.Vector3;
  /** Max use distance in metres (default 2.2). */
  radius?: number;
  /** HUD prompt, e.g. "Read terminal". Shown as "[E] Read terminal". */
  prompt: string;
  enabled: boolean;
  /** Called when the player uses it. An 'interact' event is also emitted automatically by `use()`. */
  onUse?: () => void;
}

export interface InteractableRegistry {
  add(i: Interactable): Interactable;
  remove(id: string): void;
  get(id: string): Interactable | undefined;
  /** Best enabled interactable the given eye ray is looking at (within its radius, within ~25° cone), or null. */
  pick(eye: THREE.Vector3, forward: THREE.Vector3): Interactable | null;
  /** Fire onUse + emit 'interact'. */
  use(i: Interactable): void;
  readonly all: readonly Interactable[];
}

// ───────────────────────────────────────────────────────────── render (src/render)

export type FlickerMode =
  | 'none'
  | 'fluorescent' // mostly steady, rare double-blink
  | 'broken'      // erratic, long dark gaps, buzzing
  | 'pulse'       // slow sinusoidal breathing
  | 'strobe'      // hard fast on/off
  | 'alarm';      // rotating-beacon style sweep

export interface LightDesc {
  type: 'point' | 'spot';
  position: THREE.Vector3;
  /** Spot only: world-space aim point. */
  target?: THREE.Vector3;
  color: THREE.ColorRepresentation;
  /** three.js physical units (candela). Typical ceiling fixture here: 20–80. */
  intensity: number;
  /** Cut-off distance in metres (required — lights are culled by it). */
  distance: number;
  /** Spot only (radians / 0..1). */
  angle?: number;
  penumbra?: number;
  /** Request shadows. The manager grants shadows to the few most relevant requesting lights each frame. */
  castShadow?: boolean;
  flicker?: FlickerMode;
  /** Named group for scripted control, see docs/DESIGN.md (e.g. 'fab', 'fab_emergency'). */
  group?: string;
  /** Higher wins when more lights are in range than the pool has slots. Default 1. */
  priority?: number;
  /** Spot only: draw a visible volumetric cone/shaft for this light. */
  volumetric?: boolean;
  /** Start disabled. */
  enabled?: boolean;
  /**
   * Optional world-space box outside which this light contributes nothing (soft edge). Use it for lights
   * that cannot get a shadow (point lights, low-priority spots) so they do not shine through walls:
   * normally the light's room bounds, slightly expanded.
   */
  bounds?: THREE.Box3;
  /** §8.4 (stage 3a): kept in the pool while pinned (feed rooms during a feed); no new scoring path. */
  pin?: boolean;
  /** §8.14 (stage 3a): below this render quality the light is never scored (fill lights dropped on low). */
  minQuality?: Quality;
}

export interface LightHandle {
  readonly desc: LightDesc;
  enabled: boolean;
  /** Multiplier on desc.intensity (scripting). */
  intensityScale: number;
  /** Final 0..1+ brightness factor this frame after flicker/enable (0 when off). Read-only. */
  readonly factor: number;
  /** Mutable — move the light (and call nothing else). */
  readonly position: THREE.Vector3;
  readonly target: THREE.Vector3;
  setFlicker(mode: FlickerMode): void;
  setColor(color: THREE.ColorRepresentation): void;
  /**
   * Keep an emissive fixture material in sync with this light: each frame
   * `material.emissiveIntensity = baseEmissiveIntensity * factor`.
   */
  bindEmissive(material: THREE.MeshStandardMaterial, baseEmissiveIntensity?: number): void;
  remove(): void;
}

export interface LightGroupPatch {
  enabled?: boolean;
  intensityScale?: number;
  flicker?: FlickerMode;
  color?: THREE.ColorRepresentation;
}

/**
 * Lights MUST be created through this manager, never by adding THREE.Light to the scene directly.
 * The manager owns a fixed pool of real three.js lights and maps the most relevant LightDescs onto it
 * every frame (so the shader light count never changes and nothing recompiles).
 */
export interface LightManager {
  add(desc: LightDesc): LightHandle;
  setGroup(group: string, patch: LightGroupPatch): void;
  /** All handles in a group. */
  group(group: string): readonly LightHandle[];
}

export interface PostFx {
  /** 0..1 red damage vignette (decays on its own). */
  damage(amount: number): void;
  /** 0..1 digital glitch / chromatic tearing, decays on its own unless `hold` seconds given. */
  glitch(amount: number, hold?: number): void;
  /** Fade whole image to black: 0 = clear, 1 = black. Animated over `seconds`. */
  fade(to: number, seconds: number): void;
  /** Persistent low-health desaturation/vignette, 0..1. */
  setLowHealth(amount: number): void;
  /** Exposure multiplier (1 = default). */
  setExposure(mult: number): void;
  /**
   * §8.7 (stage 3a): colour grade, animated over `seconds`. `warmth` > 0 counters the built-in teal shadows and
   * warms the white balance, < 0 colder; 0 = today's look. Optional until render implements it.
   */
  grade?(warmth: number, seconds: number): void;
}

/** §8.4 (stage 3a): a live render-to-texture surveillance view (`RenderSystem.feed`). */
export interface FeedOpts {
  name: string;
  width: number;
  height: number;
  /** Redraw rate. */
  hz: number;
  /** Rooms drawn in the feed pass (level visibility override). */
  rooms: string[];
}
export interface FeedHandle {
  /** Linear HDR target; the `feed` screen shader tone-maps it. */
  readonly texture: THREE.Texture;
  readonly camera: THREE.PerspectiveCamera;
  active: boolean;
  remove(): void;
}

export interface RenderSystem {
  readonly lights: LightManager;
  readonly post: PostFx;
  readonly quality: Quality;
  setQuality(q: Quality): void;
  /**
   * Call once after the level is built: bakes reflection environment(s), compiles shaders,
   * warms shadow maps. May be slow. `probes` are world positions at which to capture reflections.
   */
  prepare(probes: THREE.Vector3[]): Promise<void>;
  /**
   * Objects on this layer render in a second pass on top of the world with their own depth
   * (first-person weapon). Use `object.layers.set(render.viewmodelLayer)` on every mesh.
   */
  readonly viewmodelLayer: number;
  /** Render one frame (handles post-processing, light pool assignment, flicker). */
  render(dt: number): void;
  resize(width: number, height: number): void;
  /** §8.4 (stage 3a): create a surveillance feed (one active at a time). Optional until render implements it. */
  feed?(o: FeedOpts): FeedHandle;
}

// ───────────────────────────────────────────────────────────── materials (src/materials)

/**
 * All surface materials are procedural PBR (albedo + normal + roughness + metalness + AO), generated at
 * startup. UV convention: 1 UV unit = 1 metre in world space — geometry authors must generate UVs in
 * metres; the material applies its own tiling on top.
 */
export type MaterialName =
  // structural
  | 'wall_panel'          // grey-green painted steel wall panels with seams, rivets, grime
  | 'wall_panel_dark'     // darker industrial variant (fab hall, generator)
  | 'wall_medical'        // off-white clean-room panels, scuffed
  | 'floor_plate'         // diamond / tread plate steel floor
  | 'floor_grate'         // open steel grating (alpha-tested)
  | 'floor_rubber'        // dark studded rubber floor (medbay, security)
  | 'floor_concrete'      // sealed concrete with stains, cracks (fab hall)
  | 'ceiling_panel'       // dark ceiling panels with vents
  | 'trim_steel'          // brushed steel beams, frames, door frames
  | 'hazard_stripes'      // yellow/black chevrons, worn
  // props / generic
  | 'painted_yellow'      // chipped industrial yellow paint (machines, robot arms)
  | 'painted_orange'      // safety orange
  | 'painted_white'       // chipped white enamel
  | 'painted_dark'        // near-black powder coat
  | 'gunmetal'            // dark blued steel (weapons)
  | 'chrome'              // polished metal
  | 'steel_raw'           // bare scratched steel
  | 'rust'                // heavy rust
  | 'copper'              // pipes
  | 'brass'               // shell casings
  | 'rubber'              // hoses, grips, cables
  | 'plastic_dark'
  | 'plastic_white'       // medical / robot shell plastic
  | 'fabric'              // mattress, chair cloth
  | 'cloth_coverall'      // REVISION 4: worn grey-blue work coverall cloth (staff clothing, folded uniforms)
  | 'skin'                // REVISION 4: human skin (Tomas — face/hands), matte, subtle variation
  | 'conveyor_belt'       // REVISION 4: black segmented rubber belt, scuffed, with slat seams
  | 'glass_thick'         // REVISION 4: thick greenish safety glass, scratched, slightly frosted at edges
  | 'glass'               // transparent, slightly dirty
  | 'screen_off'          // dead black monitor glass
  // robots
  | 'robot_shell'         // white-grey composite shell, dirty, with panel lines
  | 'robot_frame'         // dark anodised endoskeleton
  | 'robot_joint'         // oily bare-metal actuators
  // emissive (unlit-looking; bloom picks them up)
  | 'emissive_white'
  | 'emissive_warm'
  | 'emissive_red'
  | 'emissive_amber'
  | 'emissive_cyan'
  | 'emissive_green'
  | HabitatMaterialName;

/**
 * Stage 3a habitat materials (docs/plans/stage-3a.md §8.6), implemented by task P1. Until then `get` warns and falls
 * back, and materials/defs keeps them out of its exhaustive SPECS record (P1 removes that exclusion).
 */
export type HabitatMaterialName =
  | 'wood_veneer'         // oak grain stretched 40:1, satin
  | 'wood_dark'           // walnut
  | 'fabric_warm'         // twill, per-instance vertex colour
  | 'carpet'              // loop-pile carpet with a 30 cm stripe
  | 'plaster_warm'        // roller-textured off-white plaster
  | 'terrazzo'            // Voronoi-chip terrazzo, polished
  | 'stone_pale'          // honed limestone
  | 'tile_ceramic'        // 15 cm glazed tile with grout
  | 'linoleum'            // speckled pale-green linoleum
  | 'soil'                // loam with mulch
  | 'leaf'                // alpha-tested leaf atlas, double-sided, wrap lighting
  | 'bark'                // smooth fig bark
  | 'water'               // dark high-gloss water, two scrolling ripple normals
  | 'glass_clear';        // clean architectural glass, faint fingerprints

export type DecalName =
  | 'blood_splat' | 'blood_smear' | 'blood_pool' | 'oil_stain' | 'oil_drip' | 'scorch'
  | 'bullet_metal' | 'bullet_concrete' | 'scratches' | 'grime' | 'handprint' | 'water_stain';

export type ScreenKind =
  | 'terminal_idle'    // scrolling green/amber diagnostics text
  | 'terminal_alert'   // red flashing warning
  | 'static'           // noise
  | 'choir'            // the antagonist's waveform "face"
  | 'camera_feed'      // grainy CCTV-style view
  | 'vitals'           // medical monitor traces
  | 'door_cycling'     // REVISION 5: small amber panel, "CYCLING"
  | 'door_locked'      // small red panel
  | 'door_open'        // small green panel
  // REVISION 6 (the core's two palm scanners). `text` of the option cards = the unit count, e.g. "28".
  | 'choice_stop'      // option card STOP (amber): pictogram of the units going dark + the consequence
  | 'choice_command'   // option card COMMAND (plain white): the units awake, turned to one supervisor
  | 'palm'             // palm plate. `text` = "<amber|white>|<off|standby|idle|scan|done|fail>|<LABEL>|<scan seconds>"
  // stage 3a (§8.5, §6.5): drawn by materials once P1 lands; until then a blank panel
  | 'pressure'         // pressure-door panel: `TEST|hh:mm:ss` → EQUALISING → RELEASED|CHOIR → OPEN → SECTOR SEALED
  | 'habitat_status'   // lobby status board (clock, EVENING, nodes online)
  | 'badge'            // badge reader
  | 'feed'             // live surveillance feed: `opts.texture` (RenderSystem.feed)
  | 'cctv';            // canvas CCTV animation (only if the feed spike falls back, §8.4)

/** `wayfinding` (stage 3a §8.6): habitat signage; until materials implement it, drawn like `stencil`. */
export type SignStyle = 'label' | 'warning' | 'danger' | 'directional' | 'stencil' | 'wayfinding';

export interface MaterialLibrary extends Updatable {
  /** Shared instance — do NOT mutate. Unknown names log a warning and return a fallback. */
  get(name: MaterialName): THREE.MeshStandardMaterial;
  /** Private clone you may mutate (shares textures). */
  clone(name: MaterialName, overrides?: Partial<THREE.MeshStandardMaterialParameters>): THREE.MeshStandardMaterial;
  /** Transparent decal material (use on a quad placed just off the surface; polygonOffset is pre-set). */
  decal(name: DecalName, variant?: number): THREE.Material;
  /** A material with a rendered text sign / label texture. `aspect` = width / height of the quad. */
  sign(text: string, style: SignStyle, aspect?: number): THREE.MeshStandardMaterial;
  /** Animated emissive monitor material (animated in update()). Each call returns a fresh material. */
  screen(kind: ScreenKind, opts?: { text?: string; aspect?: number; texture?: THREE.Texture }): THREE.MeshStandardMaterial;
  /** Change an existing screen material to another kind (e.g. terminal_idle → choir). */
  setScreen(material: THREE.MeshStandardMaterial, kind: ScreenKind, opts?: { text?: string; texture?: THREE.Texture }): void;
  /** Called by render.prepare() result: apply the reflection env map to all library materials. */
  setEnvMap(env: THREE.Texture | null, intensity?: number): void;
}

// ───────────────────────────────────────────────────────────── fx (src/fx)

export interface FxSystem extends Updatable {
  /** Hot metal sparks (lit streaks with gravity + bounce). */
  sparks(point: THREE.Vector3, normal: THREE.Vector3, count?: number, speed?: number): void;
  /** Soft lit smoke / dust puff. */
  smoke(point: THREE.Vector3, opts?: { count?: number; size?: number; color?: THREE.ColorRepresentation; rise?: number; life?: number }): void;
  /** Dark oil / hydraulic fluid spray (robot "blood"). */
  fluid(point: THREE.Vector3, direction: THREE.Vector3, count?: number): void;
  /**
   * Persistent surface decal (ring buffer, oldest recycled). REVISION 5.2: `owner` = what the surface belongs
   * to (HitOwner); when omitted it is looked up (dynamic boxes, registered movers), else static world.
   */
  decal(name: DecalName, point: THREE.Vector3, normal: THREE.Vector3, size?: number, owner?: HitOwner): void;
  /** Short-lived dynamic light flash (muzzle, explosion, electric arc). Pooled. */
  flash(point: THREE.Vector3, color: THREE.ColorRepresentation, intensity: number, duration: number, distance?: number): void;
  /** Crackling electric arc between two points for `duration` seconds. */
  arc(a: THREE.Vector3, b: THREE.Vector3, duration?: number): void;
  /** Explosion: flash + sparks + smoke + shockwave. */
  explosion(point: THREE.Vector3, scale?: number): void;
  /** Physically tumbling debris chunk(s); pass your own meshes (ownership transferred) or let fx make generic shards. */
  debris(point: THREE.Vector3, impulse: THREE.Vector3, meshes?: THREE.Object3D[], life?: number): void;
  /** Continuous emitter (steam leak, sparking cable, dripping). Returns stop handle. */
  emitter(kind: 'steam' | 'sparks' | 'drip' | 'dust', point: THREE.Vector3, direction?: THREE.Vector3, rate?: number): { stop(): void; enabled: boolean };
}

// ───────────────────────────────────────────────────────────── audio (src/audio)

/**
 * Voice processing names (`fx` of a line in voice/lines.*.json, audio/voicefx.ts `FX_NAMES`). `room` (dry close +
 * small-room reflections) and `door` (through a door) are stage 3a additions (§6.1, §8.11), implemented by P7.
 */
export type VoiceFxName = 'clean' | 'choir' | 'intercom' | 'headset' | 'unit' | 'foreman' | 'recorder' | 'pa' | 'room' | 'door';

/** Sound ids are free-form strings; the list implemented by audio is in docs/DESIGN.md → Audio. */
export interface PlayOpts {
  /** World position → 3D panned + distance attenuated + occluded reverb. Omit for 2D (UI / player-own). */
  position?: THREE.Vector3;
  volume?: number;
  /** Playback-rate / pitch multiplier, default 1 (audio adds small random variation itself). */
  pitch?: number;
}

/** `AudioSystem.say` options: PlayOpts plus a per-call voice processing override. */
export interface SayOpts extends PlayOpts {
  /**
   * Voice fx for this call only, in the manifest's `fx` syntax (e.g. 'room:400' = room + low-pass 400 Hz), instead
   * of the line's own. Processed buffers are cached per (id, fx).
   */
  fx?: string;
}

export interface LoopHandle {
  setVolume(v: number, fadeSeconds?: number): void;
  setPosition(p: THREE.Vector3): void;
  stop(fadeSeconds?: number): void;
}

export interface VoiceHandle {
  /** Seconds. Known immediately (from the manifest), before the audio starts. */
  readonly duration: number;
  /** Resolves when the line finished or was stopped. */
  readonly done: Promise<void>;
  setPosition(p: THREE.Vector3): void;
  stop(fadeSeconds?: number): void;
}

export interface AudioSystem extends Updatable {
  /** Must be called from a user gesture (UI start button) — resumes the AudioContext. */
  unlock(): Promise<void>;
  play(id: string, opts?: PlayOpts): void;
  loop(id: string, opts?: PlayOpts): LoopHandle;
  setMusic(state: MusicState): void;
  /** Reverb/ambience preset by room id (see docs/DESIGN.md room ids). */
  setRoom(room: string): void;
  /** Synthesised voice line for the machine intelligence CHOIR (processed, inhuman). `text` drives rhythm/length. */
  choirVoice(text: string, duration: number): void;
  /**
   * REVISION 4: play a recorded voice line by id (ids + text + durations: `voice/lines.*.json`, see
   * docs/DESIGN.md → Voices). The character's processing (CHOIR layering, intercom band-pass, unit
   * vocoder…) is chosen by audio from the line's speaker/fx in the manifest. Never throws: an unknown or
   * not-yet-generated id warns once and returns a silent handle whose duration is estimated from the text.
   */
  say(id: string, opts?: SayOpts): VoiceHandle;
  /** Fetch + decode lines ahead of time (ids or id prefixes, e.g. 'l2_tomas_'). Resolves when ready; never rejects. */
  preloadVoice(idsOrPrefixes: string[]): Promise<void>;
  setMasterVolume(v: number): void;
  /** Duck / muffle everything (pause menu, death). 0 = normal, 1 = fully muffled. */
  setMuffle(amount: number): void;
}

// ───────────────────────────────────────────────────────────── level (src/level)

export interface Door {
  readonly id: string;
  readonly position: THREE.Vector3;
  locked: boolean;
  readonly isOpen: boolean;
  /** Opens automatically when the player/enemy approaches and it is unlocked. */
  auto: boolean;
  open(): void;
  close(): void;
  /** Lock AND close. */
  lock(): void;
  unlock(): void;
  /** REVISION 5: true only when the leaves are fully shut (not merely closing). */
  readonly closed: boolean;
  /**
   * REVISION 5: override what the door's status panel shows. 'cycling' = amber "CYCLING" (locked for a
   * stated, temporary reason), 'dark' = panel off (unpowered), null = default (red locked / green open).
   * 'private' (stage 3a §8.12): blue panel, prompt "Private cabin", locked — until level implements it, as null.
   */
  setStatus(status: DoorStatus | null): void;
  /** §8.9 (stage 3a): floor y of the frame / sill (Deck 2 = 4.8). Absent = 0. */
  readonly y?: number;
}

/** Door status panel overrides (see Door.setStatus). */
export type DoorStatus = 'cycling' | 'dark' | 'private';

export interface EnemySpawn {
  id: string;
  type: EnemyType;
  position: THREE.Vector3;
  /** Facing, radians around Y. */
  yaw: number;
  /** Spawn group id (see docs/DESIGN.md). */
  group: string;
  /**
   * 'dormant' — present in the world from level load as an inert machine (in a rack / on the floor),
   *             comes alive on enemies.wakeGroup(group).
   * 'spawn'   — not present until enemies.spawnGroup(group) (emerges from vent etc.).
   */
  mode: 'dormant' | 'spawn';
  /** Optional pose hint for dormant enemies: 'rack' (hanging on a conveyor hook), 'slumped', 'standing', 'ceiling'. */
  pose?: string;
  /**
   * What a dormant machine does while inert (revision 2). 'still' (default) — nothing.
   * 'watch' — head slowly, almost imperceptibly tracks the player (stops dead if stared at from close).
   * 'work'  — repeats a slow mechanical task loop (husk at a bench); freezes when the player comes within ~6 m.
   * 'twitch' — rare small spasms.
   * 'worker' (REVISION 4) — like 'work' but does NOT freeze: keeps doing its task and ignores the player
   *            (stealth). It — and its whole group — turns hostile if the player comes within 2.2 m, fires
   *            a weapon within 14 m, damages any of them, or keeps the flashlight on its head for 1.5 s.
   */
  idle?: 'still' | 'watch' | 'work' | 'twitch' | 'worker';
}

export interface PickupSpawn {
  id: string;
  kind: PickupKind;
  position: THREE.Vector3;
  amount: number;
  yaw?: number;
}

export interface NavNode {
  id: number;
  /** §8.10 (stage 3a): `y` is the node's walkable floor (Deck 2 = 4.8), not always 0. */
  position: THREE.Vector3;
  links: number[];
  room: string;
  /** §8.10: index into the room's `floors` (nav v2); absent = the room's main floor. */
  floor?: number;
  /** §8.10: a stair link-chain node (explicit links every 1.0 m). */
  stair?: boolean;
  /**
   * §8.10 (K4): one-way links from this node (node ids) — a drop off a ledge the level declared
   * (`LevelBuild.navDrop`). Never symmetrised: enemies may go down them, never up.
   */
  drops?: number[];
}

/** §8.10 (stage 3a): one walkable floor of a room (nav v2: nodes per floor). */
export interface RoomFloor {
  y: number;
  /** Plan-view extent `[x0, x1, z0, z1]` (as built by `LevelBuild.room(…, { floors })`, K3). */
  box: [number, number, number, number];
}

export interface Room {
  id: string;
  /** Display name, e.g. "MEDICAL 3-A". */
  name: string;
  /** §8.9: y0 − 0.5 … y0 + h. */
  bounds: THREE.Box3;
  /** §8.9 (stage 3a): floor y of the room (`LevelBuild.room(…, { y0 })`); absent = 0. */
  y0?: number;
  /** §8.9 (K3): the room's main floor y as resolved by the level (same as `y0 ?? 0`). */
  floor?: number;
  /** §8.10 (stage 3a): walkable floors (nav v2); absent = one floor at `y0`. */
  floors?: readonly RoomFloor[];
}

export interface Level extends Updatable {
  /** Everything visual. Already added to ctx.scene by createLevel. */
  readonly root: THREE.Group;
  /** Static collision meshes (may be simplified invisible proxies). main.ts passes these to physics.build(). */
  readonly colliders: THREE.Mesh[];
  readonly spawn: { position: THREE.Vector3; yaw: number };
  readonly rooms: readonly Room[];
  roomAt(p: THREE.Vector3): Room | null;
  door(id: string): Door;
  readonly doors: readonly Door[];
  readonly enemySpawns: readonly EnemySpawn[];
  readonly pickupSpawns: readonly PickupSpawn[];
  readonly nav: readonly NavNode[];
  /** Positions for reflection probes (one per room). */
  readonly probes: THREE.Vector3[];
  /**
   * Named scene objects story/audio may need: e.g. 'gen_lever', 'elevator_cab', 'sec_monitor_main',
   * 'fab_conveyor'. See docs/DESIGN.md.
   */
  object(name: string): THREE.Object3D | undefined;
  /** Named animated set-pieces: e.g. 'fab_arms' (robot arms), 'fab_conveyor', 'elevator'. */
  setMachine(name: string, state: 'off' | 'idle' | 'active' | 'frenzy'): void;
  /** Named screens (materials.screen) so the story can swap what they show. */
  screen(name: string): THREE.MeshStandardMaterial | undefined;
  /**
   * Revision 2: fire a named one-shot scripted set-piece ("vignette") — ids in docs/DESIGN.md.
   * Safe to call twice (second call is ignored while running / after one-shots). Unknown ids warn once.
   */
  vignette(id: string): void;
  /**
   * REVISION 5: named world regions shared by story, level and the reachability check (ids in
   * docs/DESIGN.md → REVISION 5.1), each a list of boxes. Level 1 may return an empty record.
   */
  readonly regions: Readonly<Record<string, readonly THREE.Box3[]>>;
  /**
   * §8.4 (stage 3a): while set, only these rooms count as visible (roomVisible, the tagged-room pass, render's
   * occludeForeign, enemies' cull) — used around a feed pass. null clears it. Optional until level implements it.
   */
  setVisibilityOverride?(rooms: ReadonlySet<string> | null): void;
}

// ───────────────────────────────────────────────────────────── player (src/player)

export interface WeaponState {
  id: WeaponId;
  owned: boolean;
  /** Rounds in magazine. */
  clip: number;
  clipSize: number;
  /** Reserve ammo. */
  reserve: number;
  reloading: boolean;
}

export interface Player extends Updatable {
  /** Feet position. */
  readonly position: THREE.Vector3;
  /** Camera/eye world position. */
  readonly eye: THREE.Vector3;
  /** Normalised view direction. */
  readonly forward: THREE.Vector3;
  readonly velocity: THREE.Vector3;
  yaw: number;
  pitch: number;
  health: number;
  readonly maxHealth: number;
  readonly alive: boolean;
  /** When false the player ignores movement/weapon input (cutscenes); camera still updates from yaw/pitch. */
  controlsEnabled: boolean;
  readonly flashlightOn: boolean;
  readonly weapons: Record<WeaponId, WeaponState>;
  /** Currently held weapon, or null (unarmed at game start). */
  readonly currentWeapon: WeaponId | null;
  /** Interactable currently looked at (for the HUD prompt), or null. */
  readonly focus: Interactable | null;
  /** 0..1 how recently / strongly the player hit an enemy (for the HUD hit-marker). */
  readonly hitMarker: number;
  readonly keys: ReadonlySet<string>;

  damage(amount: number, from?: THREE.Vector3): void;
  heal(amount: number): void;
  give(kind: PickupKind, amount: number): void;
  hasKey(key: string): boolean;
  addKey(key: string): void;
  teleport(position: THREE.Vector3, yaw?: number, pitch?: number): void;
  /** Camera trauma 0..1 (shake); decays. */
  shake(amount: number): void;
  /** Scripted camera: smoothly look toward a world point over `seconds` (only when controlsEnabled=false). */
  lookAt(point: THREE.Vector3, seconds: number): void;
  /**
   * REVISION 4: external carrying velocity (m/s, world space) added to the player's movement while they
   * are on the ground — conveyor belts. null = none. The level sets/clears it every frame it applies.
   */
  setCarry(velocity: THREE.Vector3 | null): void;
  /** REVISION 4: apply only weapons, ammo, health and flashlight from a save (level-to-level carry). No teleport, no pickups. */
  applyLoadout(save: PlayerSave): void;
  /**
   * REVISION 6.1: a palm scan — the free LEFT hand laid flat on a plate for `seconds`. Starts only when the player
   * is alive, in control, the game is 'playing' and they stand within 1.0 m of the plate (horizontal), on its front
   * side; otherwise resolves 'refused' at once and nothing happens. While it runs the weapon is lowered (a reload is
   * cancelled), the view eases onto the plate and look input is damped; movement stays free. Walking more than
   * 1.3 m away, taking damage, dying, a pause / any state other than 'playing', losing control, a teleport or
   * `cancelPalm()` ends it with 'cancelled'. Releasing the key does nothing. Not persisted.
   */
  palm(plate: PalmPlate, seconds: number): Promise<PalmResult>;
  /** REVISION 6.1: abandon the running palm scan (no-op when none). */
  cancelPalm(): void;
  /** REVISION 6.1: progress 0..1 of the running palm scan; -1 when no scan is running. */
  readonly palmProgress: number;
  /**
   * §8.2 (stage 3a): cutscene mode. on: zero velocity, cancel reload / palm, ignore input, no footsteps, viewmodel
   * hidden or held lowered (`topUp`: refill the clip quietly); off: restore. Optional until player implements it (P4).
   */
  cinematic?(on: boolean, o?: { viewmodel?: 'hidden' | 'lowered'; topUp?: boolean }): void;
  /**
   * §8.3 (stage 3a): safe state. While on the weapon is stowed (as the palm scan), fire / reload / switch are
   * ignored, the crosshair is hidden; off → raise over 0.34 s. Story-driven. Optional until P4.
   */
  setSafe?(on: boolean): void;
  /** §8.3: true while `setSafe(true)` holds. */
  readonly safe?: boolean;
  /** §8.2 (stage 3a): forget a held / buffered key (the skip key must not also jump). Optional until P4. */
  consumeKey?(code: string): void;
  /** Checkpoints: plain-JSON snapshot of everything the player module owns (incl. collected pickups). */
  snapshot(): PlayerSave;
  /** Restore a snapshot: teleport, health, weapons/ammo, keys, flashlight; remove already-collected pickups. Emits no pickup events. */
  restore(save: PlayerSave): void;
}

/** REVISION 6.1: where a palm goes. All vectors in world space; `normal` and `up` are unit and perpendicular. */
export interface PalmPlate {
  /** Centre of the plate's surface. */
  position: THREE.Vector3;
  /** Outward normal of the surface. */
  normal: THREE.Vector3;
  /** The direction along the surface the fingers point: away from the user standing in front of it. */
  up: THREE.Vector3;
}
export type PalmResult = 'done' | 'cancelled' | 'refused';

/** JSON-serialisable player state for checkpoints. */
export interface PlayerSave {
  position: [number, number, number];
  yaw: number;
  health: number;
  weapons: Record<WeaponId, { owned: boolean; clip: number; reserve: number }>;
  current: WeaponId | null;
  keys: string[];
  flashlight: boolean;
  /** Ids of PickupSpawns already collected. */
  pickups: string[];
  /** §8.1 (stage 3a): armour points; absent = 0 (no armour system yet). */
  armor?: number;
}

// ───────────────────────────────────────────────────────────── enemies (src/enemies)

export interface Enemy {
  readonly id: number;
  readonly type: EnemyType;
  readonly group: string;
  /** Feet / base position. */
  readonly position: THREE.Vector3;
  readonly health: number;
  readonly alive: boolean;
  readonly state: 'dormant' | 'idle' | 'alert' | 'chase' | 'attack' | 'stagger' | 'dead';
  readonly object: THREE.Object3D;
}

export interface EnemyHit {
  enemy: Enemy;
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  /** Named part that was hit: 'head' | 'torso' | 'limb' | 'core' ... (damage multipliers are enemy-side). */
  part: string;
}

export interface EnemyManager extends Updatable {
  readonly all: readonly Enemy[];
  /** Number of awake, living enemies currently hunting the player. */
  readonly activeCount: number;
  /** Spawn directly (debug / story). */
  spawn(type: EnemyType, position: THREE.Vector3, yaw?: number, group?: string): Enemy;
  /** Bring a level-defined 'spawn'-mode group into the world. */
  spawnGroup(group: string): void;
  /** Wake a 'dormant'-mode group. `stagger` seconds between each waking, default 0.6. */
  wakeGroup(group: string, stagger?: number): void;
  /** Closest enemy hit by a ray, or null. Used by weapons. Does not apply damage. */
  hitscan(origin: THREE.Vector3, direction: THREE.Vector3, maxDistance: number): EnemyHit | null;
  /** Apply damage (emits enemy:damaged / enemy:died, spawns fx). */
  damage(hit: EnemyHit, amount: number, direction: THREE.Vector3): void;
  /** Alert everything within radius of a point (gunshot noise). */
  alertNoise(point: THREE.Vector3, radius: number): void;
  aliveInGroup(group: string): number;
  /**
   * Revision 2: a non-hostile, non-shootable puppet using the same model + animation as a real enemy,
   * for scripted scares (a silhouette crossing a doorway, a figure that is gone after a flicker).
   * Not listed in `all`, never perceives or attacks, emits no enemy:* events except `enemy:step`.
   */
  actor(type: ActorType, position: THREE.Vector3, yaw?: number, pose?: string, opts?: ActorOpts): EnemyActor;
  /**
   * Checkpoints: silently delete a whole spawn group — living, dormant, dead wrecks and not-yet-spawned
   * members — with no events, fx or sound. Afterwards spawnGroup/wakeGroup for it are no-ops and
   * aliveInGroup is 0.
   */
  removeGroup(group: string): void;
}

/** REVISION 5: how a puppet is rendered. Holograms are see-through sci-fi projections (no shadow, no collision). */
export type ActorLook = 'solid' | 'holo_ghost' | 'holo_tech';
export interface ActorOpts {
  look?: ActorLook;
  /** §8.8 (stage 3a): which person a 'human' actor is (body, head, voice). Default 'tomas'. */
  who?: ActorWho;
}
/** §8.8: the human actors. */
export type ActorWho = 'tomas' | 'halvorsen';

export interface EnemyActor {
  readonly type: ActorType;
  readonly look: ActorLook;
  readonly object: THREE.Object3D;
  readonly position: THREE.Vector3;
  /** Walk/crawl/fly in a straight line to the point with the type's normal gait; resolves on arrival. No pathfinding. */
  moveTo(point: THREE.Vector3, speed?: number): Promise<void>;
  /** Dormant pose names as in EnemySpawn.pose, plus 'idle' (standing awake). Blends over ~0.5 s. */
  setPose(pose: string): void;
  /**
   * Head/sensor tracks a world point (null = release).
   * REVISION 6.1 (human actors): attention is `auto` by default — he looks at the player whenever he can see them
   * (≤ 16 m, through glass, not through walls / closed doors), otherwise at rest. `lookAt(point)` PINS a frozen point,
   * `lookAt(object)` pins the object's live world position, `lookAt(null)` returns to `auto`. Passing the player's
   * own `player.eye` vector is the same as `auto`. Other actor types: an object is read once (its position now).
   */
  lookAt(point: THREE.Vector3 | THREE.Object3D | null): void;
  /** REVISION 6.1 (human actors): 'auto' (default; = lookAt(null)) or 'rest' (ignore the player until set back). */
  setLookMode?(mode: 'auto' | 'rest'): void;
  /** Eye / sensor glow on or off. */
  setEyes(on: boolean): void;
  /** REVISION 4: animate speech (jaw / head bob / small gestures) for this many seconds. No-op for types that cannot. */
  speak?(seconds: number): void;
  /**
   * REVISION 5: turn this solid puppet into a real, live, hostile enemy of `group` in place (same pose,
   * position and motion — no pop). Husk actors only. The actor handle is dead afterwards.
   */
  promote?(group: string): Enemy;
  /** REVISION 4: gait variant for moveTo, e.g. 'limp' (Unit 14), 'carry' (walking someone by the arm). */
  setGait?(gait: string): void;
  remove(): void;
  /** Stage 3a §8.8: character props/states (Halvorsen: glasses, mug, badge, monitor, phone, panel, desk, expr). Absent on actors without props. */
  prop?(name: string, value: unknown): void;
}

// ───────────────────────────────────────────────────────────── ui (src/ui)

export interface UISystem extends Updatable {
  /** Show main menu; resolves when the player clicks start (after unlocking audio + pointer lock). */
  showMenu(): Promise<void>;
  /** Full-screen text card (intro / chapter title / ending). Resolves when finished or skipped. */
  showCard(lines: string[], opts?: { seconds?: number; skippable?: boolean; style?: 'intro' | 'title' | 'ending' }): Promise<void>;
  /** Readable log / terminal overlay; pauses nothing by itself; resolves on close. */
  showLog(title: string, body: string): Promise<void>;
  showDeath(): Promise<void>;
  showEnding(): Promise<void>;
  setHudVisible(visible: boolean): void;
  /** §8.2 (stage 3a): cutscene skip ring, 0..1 while SPACE is held; null hides it. Optional until UI implements it (P5). */
  showSkip?(progress: number | null): void;
}

// ───────────────────────────────────────────────────────────── story (src/story)

export interface StorySystem extends Updatable {
  /** Entry point called by main.ts once everything is loaded. Owns menu → intro → gameplay → ending flow. */
  run(): Promise<void>;
  readonly objective: string;
  /** Collected log ids. */
  readonly logs: ReadonlySet<string>;
}
