// Generates a stable placeholder for products that have no image on file
// (e.g. seed data before real product photos are uploaded), so <img> tags
// never render with an empty string src. React would otherwise pass "" to
// the DOM, which the browser treats as a request to re-fetch the current
// page — the console warning that motivated this file.
function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(word => word[0]?.toUpperCase() || '')
    .join('') || '?';
}

function hueFor(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash % 360;
}

export function placeholderImage(name: string): string {
  const hue = hueFor(name || 'Product');
  const label = initials(name || 'Product');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" viewBox="0 0 200 200">
    <rect width="200" height="200" fill="hsl(${hue} 45% 92%)"/>
    <text x="100" y="112" font-family="system-ui, sans-serif" font-size="64" font-weight="600" text-anchor="middle" fill="hsl(${hue} 35% 45%)">${label}</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// Use as: <img src={safeImage(product.image, product.name)} .../>
export function safeImage(src: string | null | undefined, name: string): string {
  return src && src.trim() !== '' ? src : placeholderImage(name);
}
