/**
 * Compute accent-derived CSS variables from a single hex color and apply them to <html>.
 * This lets the entire UI theme respond dynamically to the user's chosen accent.
 */

/* ── Color conversion helpers ─────────────────────────────── */

function hexToRgb(hex) {
  const s = hex.replace(/^#/, '');
  if (s.length === 3) return [parseInt(s[0] + s[0], 16), parseInt(s[1] + s[1], 16), parseInt(s[2] + s[2], 16)];
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return [h, s, l];
}

function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return [r * 255, g * 255, b * 255];
}

function adjustLightness(hex, lightnessDelta) {
  const [r, g, b] = hexToRgb(hex);
  let [h, s, l] = rgbToHsl(r, g, b);
  l = Math.max(0, Math.min(1, l + lightnessDelta));
  const [nr, ng, nb] = hslToRgb(h, s, l);
  return rgbToHex(nr, ng, nb);
}

function normalizeHex(input) {
  if (!input) return null;
  const s = input.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) return '#' + s.slice(1)[0] + s.slice(1)[0] + s.slice(2)[0] + s.slice(2)[0] + s.slice(3)[0] + s.slice(3)[0];
  return null;
}

/* ── Public API ───────────────────────────────────────────── */

/**
 * Apply accent-derived CSS custom properties to <html>.
 * Accepts hex (#RRGGBB or #RGB), rgb(), or hsl() strings.
 */
export function applyAccentColor(accentInput) {
  let hex = normalizeHex(accentInput);

  // Fallback: try parsing rgb()/hsl() from settings DB string
  if (!hex && typeof accentInput === 'string') {
    const rgbMatch = accentInput.match(/rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)/);
    if (rgbMatch) hex = rgbToHex(+rgbMatch[1], +rgbMatch[2], +rgbMatch[3]);

    if (!hex) {
      const hslMatch = accentInput.match(/hsl\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/);
      if (hslMatch) hex = rgbToHex(...hslToRgb(+hslMatch[1] / 360, +hslMatch[2] / 100, +hslMatch[3] / 100));
    }
  }

  if (!hex) return; // leave CSS as-is (defaults in index.css kick in)

  const [r, g, b] = hexToRgb(hex);
  const lighter = adjustLightness(hex, 0.15);   // hover state
  const darker  = adjustLightness(hex, -0.12);   // gradient end
  const darkest = adjustLightness(hex, -0.25);   // user-bubble tail

  const root = document.documentElement;
  root.style.setProperty('--accent', hex);
  root.style.setProperty('--accent-hover', lighter);
  root.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.3)`);
  root.style.setProperty('--gradient-accent', `linear-gradient(135deg, ${hex} 0%, ${darker} 100%)`);
  root.style.setProperty('--user-bubble', `linear-gradient(135deg, ${hex} 0%, ${darkest} 100%)`);
}
