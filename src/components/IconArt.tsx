import type { ReactElement, ReactNode } from 'react';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { DEFAULT_CATEGORY_ICON } from '../categories';
import { AppleArt, CapsuleArt, HouseArt, JarArt, PumpBottleArt } from './Art';

// Illustrated artwork for the categories people add themselves — one picture
// per icon in the New category picker (categories.CATEGORY_ICONS), drawn in
// the same language as the built-ins in Art.tsx: a 100×100 canvas, two-stop
// gradients, a soft white highlight, no outlines. The picker itself keeps the
// plain Ionicons glyphs (clean, scannable choices); the chosen glyph's
// picture is what the folder's tile, rows and item thumbnails show. The saved
// identifier stays the Ionicons name it always was, so every folder created
// before this art existed picks up its picture automatically; an unknown name
// shows the folder.

type ArtProps = { size?: number };

// A vertical (or diagonal) two-stop gradient. Ids are prefixed per drawing so
// two different pictures on one page never share a definition.
function grad(id: string, from: string, to: string, diagonal = false) {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2={diagonal ? '1' : '0'} y2="1">
      <Stop offset="0" stopColor={from} />
      <Stop offset="1" stopColor={to} />
    </LinearGradient>
  );
}

// A four-pointed sparkle centred on (cx, cy).
function sparkle(cx: number, cy: number, r: number) {
  return `M${cx} ${cy - r} Q${cx} ${cy} ${cx + r} ${cy} Q${cx} ${cy} ${cx} ${cy + r} Q${cx} ${cy} ${cx - r} ${cy} Q${cx} ${cy} ${cx} ${cy - r} Z`;
}

function Canvas({ size = 56, children }: ArtProps & { children: ReactNode }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      {children}
    </Svg>
  );
}

const ART: Record<string, (p: ArtProps) => ReactElement> = {
  // The preset categories' own pictures, now choices like every other icon.
  apple: (p) => <AppleArt size={p.size ?? 56} />,
  capsule: (p) => <CapsuleArt size={p.size ?? 56} />,
  pump: (p) => <PumpBottleArt size={p.size ?? 56} />,
  jar: (p) => <JarArt size={p.size ?? 56} />,
  // ── Groceries and food ──
  'nutrition-outline': (p) => (
    <Canvas {...p}>
      <Defs>
        {grad('nuB', '#FFB25B', '#F06A12', true)}
        {grad('nuL', '#6BE98F', '#1FA855')}
      </Defs>
      <Path d="M64 31 C60 17 64 9 70 7 C73 17 71 25 64 31 Z" fill="url(#nuL)" />
      <Path d="M66 34 C76 24 86 24 93 28 C85 36 75 38 66 34 Z" fill="url(#nuL)" />
      <Path d="M65 32 C70 21 80 15 89 13 C85 23 75 31 65 32 Z" fill="url(#nuL)" />
      <Path d="M62 30 C73 36 73 49 64 57 L30 89 C25 93 20 88 24 83 L51 40 C54 33 57 28 62 30 Z" fill="url(#nuB)" />
      <G stroke="#FFFFFF" strokeOpacity={0.45} strokeWidth={3.5} strokeLinecap="round">
        <Path d="M52 46 L58 50" />
        <Path d="M42 60 L49 64" />
        <Path d="M34 72 L40 76" />
      </G>
    </Canvas>
  ),
  'leaf-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('lfB', '#7DEB9C', '#159A4C', true)}</Defs>
      <Path d="M18 84 C16 46 40 16 86 14 C86 58 60 84 18 84 Z" fill="url(#lfB)" />
      <Path d="M20 82 C38 64 56 46 74 28" stroke="#0E6B35" strokeOpacity={0.55} strokeWidth={4} strokeLinecap="round" fill="none" />
      <Path d="M40 62 L38 46 M52 50 L52 36 M46 56 L60 58" stroke="#0E6B35" strokeOpacity={0.35} strokeWidth={3} strokeLinecap="round" />
      <Ellipse cx="58" cy="28" rx="12" ry="5" fill="#FFFFFF" opacity={0.3} transform="rotate(-35 58 28)" />
    </Canvas>
  ),
  'egg-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('egB', '#FFF8EA', '#EBC98C', true)}</Defs>
      <Path d="M50 10 C70 10 82 42 82 62 C82 80 68 91 50 91 C32 91 18 80 18 62 C18 42 30 10 50 10 Z" fill="url(#egB)" />
      <Ellipse cx="37" cy="40" rx="7" ry="13" fill="#FFFFFF" opacity={0.7} transform="rotate(18 37 40)" />
    </Canvas>
  ),
  'fish-outline': (p) => (
    <Canvas {...p}>
      <Defs>
        {grad('fiB', '#7FD3FF', '#1C6FD8', true)}
        {grad('fiT', '#5BB8F5', '#1555B8')}
      </Defs>
      <Path d="M72 50 L93 32 C90 44 90 56 93 68 Z" fill="url(#fiT)" />
      <Path d="M10 50 C24 26 58 22 76 50 C58 78 24 74 10 50 Z" fill="url(#fiB)" />
      <Path d="M40 32 C46 26 56 26 60 30 C54 34 46 34 40 32 Z" fill="#1555B8" opacity={0.7} />
      <Path d="M46 40 C50 46 50 54 46 60" stroke="#FFFFFF" strokeOpacity={0.5} strokeWidth={3} fill="none" strokeLinecap="round" />
      <Circle cx="26" cy="47" r="5" fill="#FFFFFF" />
      <Circle cx="27" cy="47" r="2.6" fill="#0B2A4A" />
    </Canvas>
  ),
  'fast-food-outline': (p) => (
    <Canvas {...p}>
      <Defs>
        {grad('ffBun', '#FFD083', '#E3902B')}
        {grad('ffMeat', '#9A5530', '#5E2D16')}
      </Defs>
      <Path d="M14 46 C14 22 86 22 86 46 Z" fill="url(#ffBun)" />
      <G fill="#FFF3D6">
        <Ellipse cx="36" cy="33" rx="3" ry="1.8" transform="rotate(-20 36 33)" />
        <Ellipse cx="52" cy="29" rx="3" ry="1.8" />
        <Ellipse cx="66" cy="34" rx="3" ry="1.8" transform="rotate(20 66 34)" />
      </G>
      <Path d="M12 50 C20 44 26 54 34 48 C42 42 48 54 56 48 C64 42 70 54 78 48 C84 44 88 50 88 50 V54 H12 Z" fill="#46C46E" />
      <Rect x="14" y="54" width="72" height="13" rx="6.5" fill="url(#ffMeat)" />
      <Path d="M16 66 H84 L76 74 L68 67 Z" fill="#FFCB2E" />
      <Rect x="16" y="70" width="68" height="16" rx="8" fill="url(#ffBun)" />
    </Canvas>
  ),
  'pizza-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('pzC', '#FFE27A', '#F5B82E')}</Defs>
      <Path d="M50 92 L15 24 C37 14 63 14 85 24 Z" fill="url(#pzC)" />
      <Path d="M15 24 C37 13 63 13 85 24" stroke="#D98326" strokeWidth={10} strokeLinecap="round" fill="none" />
      <G fill="#E23B3B">
        <Circle cx="40" cy="38" r="7" />
        <Circle cx="60" cy="42" r="6" />
        <Circle cx="50" cy="62" r="6" />
      </G>
      <Circle cx="38" cy="36" r="2" fill="#FFFFFF" opacity={0.45} />
    </Canvas>
  ),
  'ice-cream-outline': (p) => (
    <Canvas {...p}>
      <Defs>
        {grad('icS', '#FFC4DA', '#F0679E', true)}
        {grad('icC', '#F6C77E', '#D48A35')}
      </Defs>
      <Path d="M30 50 L50 94 L70 50 Z" fill="url(#icC)" />
      <Path d="M37 56 L60 66 M34 52 L63 74 M44 52 L66 58 M40 70 L56 60 M44 80 L55 74" stroke="#A8641F" strokeOpacity={0.45} strokeWidth={2.4} />
      <Path d="M26 52 C20 32 34 16 50 16 C66 16 80 32 74 52 C66 48 60 56 50 52 C40 56 34 48 26 52 Z" fill="url(#icS)" />
      <Circle cx="52" cy="14" r="6" fill="#E0233C" />
      <Ellipse cx="38" cy="32" rx="5" ry="8" fill="#FFFFFF" opacity={0.4} transform="rotate(25 38 32)" />
    </Canvas>
  ),
  'snow-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('snB', '#B8EBFF', '#3A9BE8')}</Defs>
      <G stroke="url(#snB)" strokeWidth={7} strokeLinecap="round" fill="none">
        {[0, 60, 120].map((a) => (
          <G key={a} transform={`rotate(${a} 50 50)`}>
            <Path d="M50 12 V88" />
            <Path d="M40 20 L50 28 L60 20" />
            <Path d="M40 80 L50 72 L60 80" />
          </G>
        ))}
      </G>
      <Circle cx="50" cy="50" r="6" fill="#FFFFFF" />
    </Canvas>
  ),
  'wine-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('wnW', '#E2385A', '#8E1236')}</Defs>
      <Path d="M28 10 H72 C74 38 66 56 50 56 C34 56 26 38 28 10 Z" fill="#E8F1FA" opacity={0.85} />
      <Path d="M29 28 H71 C70 44 62 54 50 54 C38 54 30 44 29 28 Z" fill="url(#wnW)" />
      <Rect x="47" y="55" width="6" height="26" rx="3" fill="#CFDDEB" />
      <Ellipse cx="50" cy="86" rx="20" ry="6" fill="#CFDDEB" />
      <Rect x="34" y="14" width="5" height="24" rx="2.5" fill="#FFFFFF" opacity={0.7} />
    </Canvas>
  ),
  'cafe-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('cfC', '#FFFFFF', '#D9E2EA')}</Defs>
      <Path d="M38 8 C34 14 42 18 38 26 M52 8 C48 14 56 18 52 26" stroke="#B9C6D2" strokeWidth={4} strokeLinecap="round" fill="none" />
      <Path d="M72 44 C86 44 86 66 70 66" stroke="#C8D3DD" strokeWidth={7} fill="none" strokeLinecap="round" />
      <Path d="M20 34 H76 V62 C76 78 64 86 48 86 C32 86 20 78 20 62 Z" fill="url(#cfC)" />
      <Ellipse cx="48" cy="35" rx="27" ry="6" fill="#7A4523" />
      <Ellipse cx="48" cy="90" rx="34" ry="6" fill="#C8D3DD" />
      <Rect x="26" y="44" width="5" height="26" rx="2.5" fill="#FFFFFF" opacity={0.9} />
    </Canvas>
  ),
  'pint-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('ptB', '#FFD45C', '#E89412')}</Defs>
      <Path d="M27 24 H73 L67 90 H33 Z" fill="url(#ptB)" />
      <Path d="M24 26 C22 12 34 10 40 14 C46 6 58 8 62 14 C70 10 80 16 76 26 C76 32 24 32 24 26 Z" fill="#FFFFFF" />
      <Rect x="35" y="36" width="5" height="44" rx="2.5" fill="#FFFFFF" opacity={0.4} />
      <G fill="#FFFFFF" opacity={0.6}>
        <Circle cx="56" cy="50" r="2" />
        <Circle cx="60" cy="64" r="1.6" />
        <Circle cx="52" cy="74" r="1.8" />
      </G>
    </Canvas>
  ),
  'water-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('wtD', '#8FE0FF', '#1F7FE0', true)}</Defs>
      <Path d="M50 8 C60 28 78 44 78 64 C78 80 65 92 50 92 C35 92 22 80 22 64 C22 44 40 28 50 8 Z" fill="url(#wtD)" />
      <Path d="M36 62 C36 72 42 78 50 80" stroke="#FFFFFF" strokeOpacity={0.6} strokeWidth={5} strokeLinecap="round" fill="none" />
    </Canvas>
  ),
  'basket-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('bkB', '#E8B26A', '#B0702A')}</Defs>
      <Path d="M28 44 C28 18 72 18 72 44" stroke="#8A5520" strokeWidth={6} fill="none" strokeLinecap="round" />
      <Path d="M14 46 H86 L77 88 H23 Z" fill="url(#bkB)" />
      <Rect x="10" y="40" width="80" height="11" rx="5.5" fill="#C98538" />
      <G stroke="#8A5520" strokeOpacity={0.5} strokeWidth={3}>
        <Path d="M18 62 H82 M21 75 H79" />
        <Path d="M36 51 L38 88 M50 51 V88 M64 51 L62 88" />
      </G>
    </Canvas>
  ),
  'cube-outline': (p) => (
    <Canvas {...p}>
      <Path d="M16 36 L50 22 L84 36 L50 50 Z" fill="#F3CB86" />
      <Path d="M16 36 L50 50 V90 L16 76 Z" fill="#D9A257" />
      <Path d="M50 50 L84 36 V76 L50 90 Z" fill="#C08438" />
      <Path d="M33 29 L67 43 V54 L60 51 V44" fill="#FFFFFF" opacity={0.45} />
    </Canvas>
  ),
  'archive-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('arB', '#9FB9D6', '#5E7FA6')}</Defs>
      <Rect x="18" y="34" width="64" height="54" rx="8" fill="url(#arB)" />
      <Rect x="12" y="16" width="76" height="20" rx="7" fill="#7E9BBE" />
      <Rect x="38" y="48" width="24" height="9" rx="4.5" fill="#3E5878" />
      <Rect x="22" y="40" width="5" height="40" rx="2.5" fill="#FFFFFF" opacity={0.35} />
    </Canvas>
  ),
  // ── Home and care ──
  'home-outline': (p) => <HouseArt size={0.95 * (p.size ?? 56)} />,
  'restaurant-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('rsP', '#FFFFFF', '#CFD8E2', true)}</Defs>
      <Circle cx="50" cy="54" r="30" fill="url(#rsP)" />
      <Circle cx="50" cy="54" r="20" fill="#EEF2F6" />
      <G stroke="#8A97A6" strokeWidth={5} strokeLinecap="round" fill="none">
        <Path d="M12 14 V40 M8 14 V28 C8 34 16 34 16 28 V14" />
        <Path d="M12 40 V88" />
        <Path d="M88 88 V14 C80 20 80 40 88 46" />
      </G>
    </Canvas>
  ),
  'brush-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('brH', '#E5A86A', '#A8652B')}</Defs>
      <G transform="rotate(40 50 50)">
        <Rect x="44" y="4" width="12" height="46" rx="6" fill="url(#brH)" />
        <Rect x="41" y="48" width="18" height="12" rx="2" fill="#B9C4CF" />
        <Path d="M40 60 H60 L62 80 C62 92 38 92 38 80 Z" fill="#7C5CFF" />
        <Rect x="47" y="10" width="3" height="34" rx="1.5" fill="#FFFFFF" opacity={0.4} />
      </G>
    </Canvas>
  ),
  'color-fill-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('cfB2', '#B7C5D3', '#7D8FA2')}</Defs>
      <Path d="M28 40 C28 14 72 14 72 40" stroke="#6C7C8E" strokeWidth={5} fill="none" />
      <Path d="M22 38 H78 L72 90 H28 Z" fill="url(#cfB2)" />
      <Path d="M22 38 H78 V46 C70 46 70 62 64 62 C58 62 60 48 54 48 C48 48 48 56 42 56 C36 56 34 46 22 46 Z" fill="#20B486" />
      <Rect x="30" y="58" width="5" height="26" rx="2.5" fill="#FFFFFF" opacity={0.35} />
    </Canvas>
  ),
  'sparkles-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('spS', '#FFE680', '#F5A623', true)}</Defs>
      <Path d={sparkle(42, 56, 34)} fill="url(#spS)" />
      <Path d={sparkle(76, 24, 16)} fill="url(#spS)" />
      <Path d={sparkle(78, 74, 10)} fill="url(#spS)" />
    </Canvas>
  ),
  'shirt-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('shB', '#7CC4FF', '#2F6FE0', true)}</Defs>
      <Path d="M34 12 L16 20 L6 42 L22 49 L27 41 V90 H73 V41 L78 49 L94 42 L84 20 L66 12 C62 22 38 22 34 12 Z" fill="url(#shB)" />
      <Path d="M34 12 C38 22 62 22 66 12" stroke="#1D4FB0" strokeWidth={3} fill="none" />
      <Rect x="33" y="46" width="5" height="36" rx="2.5" fill="#FFFFFF" opacity={0.35} />
    </Canvas>
  ),
  'eyedrop-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('edB', '#D89A55', '#8C5418', true)}</Defs>
      <Path d="M44 8 C52 8 56 12 56 20 V30 H44 V20 C44 14 44 8 44 8 Z" fill="#2B2F36" />
      <Path d="M38 8 C38 4 62 4 62 8 V30 H38 Z" fill="#3A4049" />
      <Rect x="40" y="28" width="20" height="12" rx="3" fill="#C9D2DC" />
      <Rect x="26" y="40" width="48" height="52" rx="12" fill="url(#edB)" />
      <Rect x="33" y="56" width="34" height="22" rx="4" fill="#FFFFFF" opacity={0.9} />
      <Rect x="30" y="46" width="5" height="38" rx="2.5" fill="#FFFFFF" opacity={0.35} />
    </Canvas>
  ),
  'flower-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('flP', '#FFC1DC', '#EE5C9A')}</Defs>
      {[0, 72, 144, 216, 288].map((a) => (
        <Ellipse key={a} cx="50" cy="28" rx="15" ry="22" fill="url(#flP)" transform={`rotate(${a} 50 50)`} />
      ))}
      <Circle cx="50" cy="50" r="13" fill="#FFCB2E" />
      <Circle cx="46" cy="46" r="4" fill="#FFFFFF" opacity={0.5} />
    </Canvas>
  ),
  'rose-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('roB', '#FF6F8A', '#C3133F', true)}</Defs>
      <Path d="M50 52 V94" stroke="#1FA855" strokeWidth={5} strokeLinecap="round" />
      <Path d="M50 74 C40 64 28 66 24 72 C34 80 44 78 50 74 Z" fill="#2DBE63" />
      <Path d="M24 30 C24 12 40 8 50 16 C60 8 76 12 76 30 C76 48 62 58 50 58 C38 58 24 48 24 30 Z" fill="url(#roB)" />
      <Path d="M40 30 C40 22 58 20 60 30 C62 40 46 44 44 36 C42 30 52 28 52 34" stroke="#8C0B2C" strokeOpacity={0.55} strokeWidth={3} fill="none" strokeLinecap="round" />
    </Canvas>
  ),
  'medkit-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('mkB', '#FF7A7A', '#D6283A')}</Defs>
      <Path d="M36 28 V20 C36 16 40 14 44 14 H56 C60 14 64 16 64 20 V28" stroke="#A81C2B" strokeWidth={6} fill="none" />
      <Rect x="12" y="28" width="76" height="58" rx="13" fill="url(#mkB)" />
      <Path d="M44 42 H56 V51 H65 V63 H56 V72 H44 V63 H35 V51 H44 Z" fill="#FFFFFF" />
      <Rect x="17" y="34" width="5" height="44" rx="2.5" fill="#FFFFFF" opacity={0.35} />
    </Canvas>
  ),
  'bandage-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('bdB', '#F7CFA2', '#DDA066')}</Defs>
      <G transform="rotate(-40 50 50)">
        <Rect x="6" y="34" width="88" height="32" rx="16" fill="url(#bdB)" />
        <Rect x="36" y="34" width="28" height="32" rx="4" fill="#FCE6CC" />
        <G fill="#C98A4E" opacity={0.6}>
          <Circle cx="44" cy="44" r="2" />
          <Circle cx="56" cy="44" r="2" />
          <Circle cx="44" cy="56" r="2" />
          <Circle cx="56" cy="56" r="2" />
        </G>
      </G>
    </Canvas>
  ),
  'thermometer-outline': (p) => (
    <Canvas {...p}>
      <Rect x="38" y="8" width="24" height="64" rx="12" fill="#E7EEF5" />
      <Circle cx="50" cy="76" r="17" fill="#E7EEF5" />
      <Rect x="45" y="30" width="10" height="44" rx="5" fill="#E8344A" />
      <Circle cx="50" cy="76" r="11" fill="#E8344A" />
      <G stroke="#9AA9B8" strokeWidth={3} strokeLinecap="round">
        <Path d="M64 22 H70 M64 34 H70 M64 46 H70" />
      </G>
      <Circle cx="46" cy="72" r="3" fill="#FFFFFF" opacity={0.6} />
    </Canvas>
  ),
  'balloon-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('blB', '#FF8A8A', '#D42F4A', true)}</Defs>
      <Path d="M50 70 C52 78 44 84 50 94" stroke="#9AA9B8" strokeWidth={2.5} fill="none" strokeLinecap="round" />
      <Path d="M50 6 C70 6 82 22 82 38 C82 56 64 68 50 68 C36 68 18 56 18 38 C18 22 30 6 50 6 Z" fill="url(#blB)" />
      <Path d="M44 68 H56 L52 74 H48 Z" fill="#B0263C" />
      <Ellipse cx="36" cy="28" rx="6" ry="11" fill="#FFFFFF" opacity={0.4} transform="rotate(25 36 28)" />
    </Canvas>
  ),
  'paw-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('pwB', '#C08A5A', '#7A4A24', true)}</Defs>
      <Path d="M50 50 C64 50 78 64 78 76 C78 86 70 90 62 88 C56 87 54 84 50 84 C46 84 44 87 38 88 C30 90 22 86 22 76 C22 64 36 50 50 50 Z" fill="url(#pwB)" />
      <Ellipse cx="22" cy="44" rx="9" ry="12" fill="url(#pwB)" transform="rotate(-20 22 44)" />
      <Ellipse cx="38" cy="24" rx="9" ry="13" fill="url(#pwB)" transform="rotate(-8 38 24)" />
      <Ellipse cx="62" cy="24" rx="9" ry="13" fill="url(#pwB)" transform="rotate(8 62 24)" />
      <Ellipse cx="78" cy="44" rx="9" ry="12" fill="url(#pwB)" transform="rotate(20 78 44)" />
    </Canvas>
  ),
  // ── Tech and everything else ──
  'battery-charging-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('btB', '#7BEA8F', '#1FA855')}</Defs>
      <Rect x="8" y="28" width="76" height="44" rx="11" fill="#2E3A46" />
      <Rect x="84" y="40" width="8" height="20" rx="3" fill="#2E3A46" />
      <Rect x="14" y="34" width="64" height="32" rx="7" fill="url(#btB)" />
      <Path d="M50 30 L36 54 H48 L44 70 L62 44 H50 Z" fill="#FFE14D" stroke="#2E3A46" strokeWidth={2} strokeLinejoin="round" />
    </Canvas>
  ),
  'hardware-chip-outline': (p) => (
    <Canvas {...p}>
      <G stroke="#B9C4CF" strokeWidth={5} strokeLinecap="round">
        {[34, 50, 66].map((v) => (
          <G key={v}>
            <Path d={`M${v} 8 V20 M${v} 80 V92 M8 ${v} H20 M80 ${v} H92`} />
          </G>
        ))}
      </G>
      <Rect x="18" y="18" width="64" height="64" rx="10" fill="#26323E" />
      <Rect x="34" y="34" width="32" height="32" rx="5" fill="#F5B82E" />
      <Rect x="38" y="38" width="10" height="10" rx="2" fill="#FFFFFF" opacity={0.45} />
    </Canvas>
  ),
  'bulb-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('buG', '#FFF07A', '#F5B21E', true)}</Defs>
      <Path d="M50 6 C70 6 82 21 82 38 C82 52 72 60 66 68 H34 C28 60 18 52 18 38 C18 21 30 6 50 6 Z" fill="url(#buG)" />
      <Rect x="34" y="68" width="32" height="8" rx="3" fill="#B9C4CF" />
      <Rect x="36" y="76" width="28" height="8" rx="3" fill="#9AA9B8" />
      <Path d="M42 88 H58" stroke="#7D8C9C" strokeWidth={6} strokeLinecap="round" />
      <Ellipse cx="36" cy="30" rx="6" ry="11" fill="#FFFFFF" opacity={0.5} transform="rotate(25 36 30)" />
    </Canvas>
  ),
  'tv-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('tvS', '#4C8DFF', '#1C2E7A', true)}</Defs>
      <Rect x="8" y="16" width="84" height="58" rx="10" fill="#2E3A46" />
      <Rect x="14" y="22" width="72" height="46" rx="6" fill="url(#tvS)" />
      <Path d="M18 26 L44 26 L20 58 Z" fill="#FFFFFF" opacity={0.15} />
      <Path d="M38 74 L34 86 H66 L62 74" fill="#9AA9B8" />
      <Rect x="28" y="84" width="44" height="6" rx="3" fill="#7D8C9C" />
    </Canvas>
  ),
  'laptop-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('lpS', '#62B6FF', '#2349B8', true)}</Defs>
      <Rect x="16" y="16" width="68" height="48" rx="7" fill="#3A4652" />
      <Rect x="21" y="21" width="58" height="38" rx="4" fill="url(#lpS)" />
      <Path d="M8 68 H92 L86 80 C85 83 82 84 79 84 H21 C18 84 15 83 14 80 Z" fill="#C3CDD7" />
      <Rect x="42" y="68" width="16" height="4" rx="2" fill="#9AA9B8" />
      <Path d="M24 24 L44 24 L26 50 Z" fill="#FFFFFF" opacity={0.15} />
    </Canvas>
  ),
  'headset-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('hsC', '#8C7BFF', '#4B32D1', true)}</Defs>
      <Path d="M18 60 V48 C18 28 32 12 50 12 C68 12 82 28 82 48 V60" stroke="#3A4652" strokeWidth={8} fill="none" strokeLinecap="round" />
      <Rect x="10" y="50" width="22" height="38" rx="10" fill="url(#hsC)" />
      <Rect x="68" y="50" width="22" height="38" rx="10" fill="url(#hsC)" />
      <Rect x="14" y="56" width="4" height="24" rx="2" fill="#FFFFFF" opacity={0.4} />
    </Canvas>
  ),
  'watch-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('wcS', '#3A4652', '#1C232B')}</Defs>
      <Rect x="34" y="4" width="32" height="26" rx="6" fill="url(#wcS)" />
      <Rect x="34" y="70" width="32" height="26" rx="6" fill="url(#wcS)" />
      <Circle cx="50" cy="50" r="27" fill="#B9C4CF" />
      <Circle cx="50" cy="50" r="21" fill="#FFFFFF" />
      <Path d="M50 36 V50 L60 56" stroke="#2E3A46" strokeWidth={4} strokeLinecap="round" fill="none" />
      <Circle cx="50" cy="50" r="3" fill="#E8344A" />
    </Canvas>
  ),
  'car-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('crB', '#FF7A5C', '#D6362A', true)}</Defs>
      <Path d="M24 46 L32 28 C34 24 37 22 41 22 H59 C63 22 66 24 68 28 L76 46 Z" fill="#D6362A" />
      <Path d="M33 44 L38 31 C39 29 40 28 42 28 H48 V44 Z M52 28 H58 C60 28 61 29 62 31 L67 44 H52 Z" fill="#BFE3FF" />
      <Rect x="10" y="44" width="80" height="26" rx="10" fill="url(#crB)" />
      <Circle cx="28" cy="72" r="10" fill="#26323E" />
      <Circle cx="72" cy="72" r="10" fill="#26323E" />
      <Circle cx="28" cy="72" r="4" fill="#B9C4CF" />
      <Circle cx="72" cy="72" r="4" fill="#B9C4CF" />
      <Rect x="12" y="50" width="10" height="6" rx="3" fill="#FFE14D" />
    </Canvas>
  ),
  'key-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('kyG', '#FFE27A', '#D99A1E', true)}</Defs>
      <G transform="rotate(-40 50 50)">
        <Circle cx="26" cy="50" r="18" fill="url(#kyG)" />
        <Circle cx="22" cy="50" r="6" fill="#FFFFFF" />
        <Rect x="40" y="45" width="50" height="10" rx="4" fill="url(#kyG)" />
        <Rect x="70" y="55" width="8" height="12" rx="2" fill="#D99A1E" />
        <Rect x="82" y="55" width="8" height="9" rx="2" fill="#D99A1E" />
      </G>
    </Canvas>
  ),
  'book-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('bkC', '#5CC8A8', '#127A63', true)}</Defs>
      <Rect x="24" y="14" width="60" height="76" rx="6" fill="#F5F0E4" />
      <Rect x="16" y="10" width="62" height="76" rx="7" fill="url(#bkC)" />
      <Rect x="16" y="10" width="11" height="76" rx="5" fill="#0E5E4C" />
      <Rect x="36" y="26" width="32" height="6" rx="3" fill="#FFFFFF" opacity={0.7} />
      <Rect x="36" y="37" width="22" height="5" rx="2.5" fill="#FFFFFF" opacity={0.5} />
    </Canvas>
  ),
  'pricetag-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('pgT', '#FFB36B', '#F0712A', true)}</Defs>
      <Path d="M52 10 H84 C87 10 90 13 90 16 V48 C90 50 89 52 88 53 L52 89 C49 92 45 92 42 89 L11 58 C8 55 8 51 11 48 L47 12 C48 11 50 10 52 10 Z" fill="url(#pgT)" />
      <Circle cx="72" cy="28" r="7" fill="#FFFFFF" />
      <Path d="M36 56 L52 40 M44 64 L60 48" stroke="#FFFFFF" strokeOpacity={0.55} strokeWidth={4} strokeLinecap="round" />
    </Canvas>
  ),
  'gift-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('gfB', '#B98CFF', '#6B3FE0', true)}</Defs>
      <Path d="M50 28 C40 12 22 14 26 24 C29 31 44 30 50 28 Z M50 28 C60 12 78 14 74 24 C71 31 56 30 50 28 Z" fill="#FFCB2E" />
      <Rect x="18" y="44" width="64" height="46" rx="6" fill="url(#gfB)" />
      <Rect x="12" y="28" width="76" height="18" rx="5" fill="#8A5CF0" />
      <Rect x="44" y="28" width="12" height="62" fill="#FFCB2E" />
    </Canvas>
  ),
  'globe-outline': (p) => (
    <Canvas {...p}>
      <Defs>{grad('glS', '#6FC8FF', '#1E66D0', true)}</Defs>
      <Circle cx="50" cy="50" r="40" fill="url(#glS)" />
      <Path d="M28 24 C38 22 44 30 40 38 C36 46 26 44 22 52 C18 46 18 34 28 24 Z" fill="#46C46E" />
      <Path d="M56 30 C66 26 78 34 76 46 C74 56 64 52 60 62 C56 72 46 72 46 62 C46 52 54 50 52 42 C50 36 50 32 56 30 Z" fill="#46C46E" />
      <Path d="M34 74 C40 70 48 74 46 82 C40 84 34 80 34 74 Z" fill="#46C46E" />
      <Ellipse cx="36" cy="30" rx="8" ry="12" fill="#FFFFFF" opacity={0.18} transform="rotate(30 36 30)" />
    </Canvas>
  ),
  'folder-outline': (p) => (
    <Canvas {...p}>
      <Defs>
        {grad('fdB', '#FFD25E', '#F2A516')}
        {grad('fdF', '#FFE08A', '#F6B52A')}
      </Defs>
      <Path d="M10 24 C10 20 13 18 16 18 H38 C41 18 43 19 45 22 L49 28 H84 C87 28 90 31 90 34 V80 C90 84 87 86 84 86 H16 C13 86 10 84 10 80 Z" fill="url(#fdB)" />
      <Path d="M10 40 C10 37 13 34 16 34 H84 C87 34 90 37 90 40 V80 C90 84 87 86 84 86 H16 C13 86 10 84 10 80 Z" fill="url(#fdF)" />
      <Rect x="16" y="40" width="68" height="5" rx="2.5" fill="#FFFFFF" opacity={0.45} />
    </Canvas>
  ),
};

// The illustration for a saved folder icon (an Ionicons name, as stored).
export function IconArt({ icon, size = 56 }: { icon: string; size?: number }) {
  const draw = ART[icon] ?? ART[DEFAULT_CATEGORY_ICON];
  return draw({ size });
}
