import type { Quality } from '../core/types';

export interface QualityPreset {
  /** Internal resolution budget in pixels (the canvas backbuffer is sized to fit it). */
  maxPixels: number;
  maxPixelRatio: number;
  /** MSAA samples on the scene / viewmodel targets. */
  msaa: number;
  /** MSAA on the viewmodel target (a second full-screen MSAA resolve is expensive; FXAA covers it below ultra). */
  vmMsaa: number;
  fxaa: boolean;
  /** Shadow-casting spot slots, their map size, and how often static ones refresh (frames). */
  shadowSlots: number;
  shadowSize: number;
  shadowEvery: number;
  /** Extra non-shadowed spot slots / point slots. */
  spotSlots: number;
  pointSlots: number;
  ao: boolean;
  aoSamples: number;
  volumetrics: boolean;
  volSteps: number;
  /** Volumetric buffer scale relative to the scene buffer. */
  volScale: number;
  volShadows: boolean;
  bloomMips: number;
  /** Reflection probe capture face size. */
  probeSize: number;
}

export const QUALITY: Record<Quality, QualityPreset> = {
  low: {
    maxPixels: 0.95e6, maxPixelRatio: 1, msaa: 0, vmMsaa: 0, fxaa: true,
    shadowSlots: 2, shadowSize: 512, shadowEvery: 3, spotSlots: 8, pointSlots: 6,
    ao: false, aoSamples: 0, volumetrics: true, volSteps: 6, volScale: 0.5, volShadows: false,
    bloomMips: 5, probeSize: 128,
  },
  medium: {
    maxPixels: 1.5e6, maxPixelRatio: 1.25, msaa: 2, vmMsaa: 0, fxaa: true,
    shadowSlots: 3, shadowSize: 1024, shadowEvery: 3, spotSlots: 9, pointSlots: 8,
    ao: true, aoSamples: 8, volumetrics: true, volSteps: 8, volScale: 0.5, volShadows: true,
    bloomMips: 6, probeSize: 128,
  },
  high: {
    maxPixels: 2.3e6, maxPixelRatio: 1.5, msaa: 4, vmMsaa: 0, fxaa: true,
    shadowSlots: 4, shadowSize: 1024, shadowEvery: 2, spotSlots: 10, pointSlots: 10,
    ao: true, aoSamples: 12, volumetrics: true, volSteps: 12, volScale: 0.5, volShadows: true,
    bloomMips: 6, probeSize: 256,
  },
  ultra: {
    maxPixels: 4.2e6, maxPixelRatio: 2, msaa: 4, vmMsaa: 4, fxaa: true,
    shadowSlots: 4, shadowSize: 2048, shadowEvery: 1, spotSlots: 12, pointSlots: 12,
    ao: true, aoSamples: 16, volumetrics: true, volSteps: 16, volScale: 0.75, volShadows: true,
    bloomMips: 7, probeSize: 256,
  },
};
