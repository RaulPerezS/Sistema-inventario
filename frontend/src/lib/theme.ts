import { useEffect, useState } from 'react';

const SERIES = ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6', 'chart-7', 'chart-8'] as const;
const TOKENS = ['brand-500', 'accent-500', 'navy-800', 'success', 'chart-grid', 'chart-axis', ...SERIES] as const;
type Token = (typeof TOKENS)[number];

function read(): Record<Token, string> {
  const style = getComputedStyle(document.documentElement);
  const out = {} as Record<Token, string>;
  for (const t of TOKENS) out[t] = style.getPropertyValue(`--color-${t}`).trim();
  return out;
}

/**
 * Colores del sistema de diseño (definidos en index.css) para librerías que necesitan
 * valores concretos, como Recharts. Se actualiza al cambiar entre tema claro y oscuro.
 */
export function useThemeColors() {
  const [colors, setColors] = useState(read);
  useEffect(() => {
    const observer = new MutationObserver(() => setColors(read()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);
  return { ...colors, series: SERIES.map((t) => colors[t]) };
}
