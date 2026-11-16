/** Shared story scaffolding for levels 2+ (stage 3a §8.13). How to use it: ./README.md. */
export {
  StageBase, extendFacts, V, DEG, face,
  type StageProgress, type StageHooks, type CheckpointRule, type CommonFacts, type FightTarget, type FightOpts,
} from './base';
export { Dialogue, U, C, type Rule, type Rules, type DialogueConfig, type SayOpts, type LineLog, type Pri } from './dialogue';
export { applyPhaseSafe, boxXZ, inRegion, inRegion3, regionBoxes, type LevelApplyPhase, type RegionFallback } from './phases';
export { createStagePage, type StagePage, type StageFlow, type StageScript } from './page';
