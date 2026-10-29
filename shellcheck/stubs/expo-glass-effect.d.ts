// Type-check stub for expo-glass-effect (not installed in this repo's node_modules —
// the shell project installs it separately). Mirrors the shipped API surface:
// GlassView (iOS 26 liquid glass; a plain View elsewhere) + isLiquidGlassAvailable().
declare module 'expo-glass-effect' {
  import type { ComponentType, ReactNode } from 'react';
  import type { ViewProps } from 'react-native';

  export type GlassEffectStyle = 'regular' | 'clear' | 'extraClear' | 'regularMaterial' | 'clearMaterial';

  export function isLiquidGlassAvailable(): boolean;

  export interface GlassViewProps extends ViewProps {
    glassEffectStyle?: GlassEffectStyle;
    tintColor?: string;
    isInteractive?: boolean;
    children?: ReactNode;
  }

  export const GlassView: ComponentType<GlassViewProps>;
}
