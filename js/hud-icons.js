// Crisp 1-bit/2-bit Game Boy pixel-art SVG icons (zero emoji, pure DOM, crispEdges).
// Every icon uses CSS custom properties so it automatically matches CGB Color and DMG Green palettes.

const SVG_NS = 'http://www.w3.org/2000/svg';

// Legend for ASCII pixel grids:
//   '.' = transparent
//   'k' = dark outline (#101520 / #081820)
//   'l' = light cream (#f6f1dc / #e0f8d0)
//   'g' = warm gold (#f8d068 / #e0f8d0)
//   'o' = amber/flame (#e07828 / #88c070)
//   's' = stone/slate mid (#98a6b8 / #88c070)
//   'd' = dim/unlit (#4b586e / #346856)
//   'c' = cloak blue-slate (#6e84a3 / #88c070)
const COLOR_MAP = {
  k: 'var(--px-k)',
  l: 'var(--px-l)',
  g: 'var(--px-g)',
  o: 'var(--px-o)',
  s: 'var(--px-s)',
  d: 'var(--px-d)',
  c: 'var(--px-c)',
};

const GRIDS = {
  emberOn: [
    '....k...',
    '...kok..',
    '..koogk.',
    '.koogogk',
    '.koggogk',
    '.koglgok',
    '..kgggk.',
    '...kkk..',
  ],
  emberOff: [
    '....k...',
    '...kdk..',
    '..kdddk.',
    '.kddkddk',
    '.kddkddk',
    '.kddkddk',
    '..kdddk.',
    '...kkk..',
  ],
  beaconLit: [
    '...kgk..',
    '..kglgk.',
    '...kok..',
    '..klllk.',
    '...ksk..',
    '...ksk..',
    '..ksssk.',
    '.ksssssk',
  ],
  beaconOff: [
    '........',
    '........',
    '..kdddk.',
    '...kdk..',
    '...kdk..',
    '...kdk..',
    '..kdddk.',
    '.kdddddk',
  ],
  star: [
    '...k....',
    '..kgk...',
    '.kgggk..',
    'kgglggk.',
    '.kgggk..',
    '..kgk...',
    '...k....',
  ],
  lantern: [
    '....kkkk....',
    '...kggggk...',
    '..kkkkkkkk..',
    '..kgoooogk..',
    '..kogllgok..',
    '..kogllgok..',
    '..kgoooogk..',
    '..kkkkkkkk..',
    '...kggggk...',
    '....kkkk....',
  ],
  stones: [
    '............',
    '....kkkk....',
    '...kllllk...',
    '..klsssslk..',
    '..kssssssk..',
    '...kkkkkk...',
    '.kkkk..kkkk.',
    'kllsskksllsk',
    'ksssskkssssk',
    '.kkkkkkkkkk.',
  ],
  cloak: [
    '....kkkk....',
    '...kcccck...',
    '..kccllcck..',
    '..kcccccck..',
    '.kcckkkkcck.',
    '.kcccccccck.',
    'kccclccclcck',
    'kccccccccck.',
    '.kkk.kk.kkk.',
    '............',
  ],
  flame: [
    '.....kk.....',
    '....kook....',
    '...koogok...',
    '..kooggook..',
    '..kogllgok..',
    '.koogllgook.',
    '.kogllllgok.',
    '..koggggok..',
    '...koooook..',
    '....kkkk....',
  ],
  gift: [
    '.....kk.....',
    '....kggk....',
    '...kglggk...',
    '..kggllggk..',
    '.kggllllggk.',
    '..kggllggk..',
    '...kggggk...',
    '....kggk....',
    '.....kk.....',
    '............',
  ],
  heart: [
    '..kk....kk..',
    '.kggk..kggk.',
    'kglggkkggggk',
    'kgllgggggggk',
    'kggggggggggk',
    '.kggggggggk.',
    '..kggggggk..',
    '...kggggk...',
    '....kggk....',
    '.....kk.....',
  ],
  map: [
    '............',
    '.kkk....kkk.',
    'klllk..klllk',
    'klsskkkksslk',
    'klsllssllslk',
    'klsllssllslk',
    'kllssllssllk',
    'klllk..klllk',
    '.kkk....kkk.',
    '............',
  ],
  soundOn: [
    '.....kk.....',
    '....klk..l..',
    '...kllk...l.',
    '.kklllk.l.l.',
    '.kllllk..l..',
    '.kllllk..l..',
    '.kklllk.l.l.',
    '...kllk...l.',
    '....klk..l..',
    '.....kk.....',
  ],
  soundOff: [
    '.....kk.....',
    '....kdk.....',
    '...kddk.....',
    '.kkdddk.o.o.',
    '.kddddk..o..',
    '.kddddk..o..',
    '.kkdddk.o.o.',
    '...kddk.....',
    '....kdk.....',
    '.....kk.....',
  ],
  menu: [
    '............',
    '.kkkkkkkkkk.',
    '.kllllllllk.',
    '.kkkkkkkkkk.',
    '.kllllllllk.',
    '.kkkkkkkkkk.',
    '.kllllllllk.',
    '.kkkkkkkkkk.',
    '............',
    '............',
  ],
  close: [
    '............',
    '.kk......kk.',
    '.kllk..kllk.',
    '..kllkkllk..',
    '...kllllk...',
    '...kllllk...',
    '..kllkkllk..',
    '.kllk..kllk.',
    '.kk......kk.',
    '............',
  ],
  fullscreenOn: [
    '............',
    '.kkkk..kkkk.',
    '.kllk..kllk.',
    '.klk....klk.',
    '.kk......kk.',
    '.kk......kk.',
    '.klk....klk.',
    '.kllk..kllk.',
    '.kkkk..kkkk.',
    '............',
  ],
  fullscreenOff: [
    '............',
    '...kk..kk...',
    '..klk..klk..',
    '.kllk..kllk.',
    '.kkkk..kkkk.',
    '.kkkk..kkkk.',
    '.kllk..kllk.',
    '..klk..klk..',
    '...kk..kk...',
    '............',
  ],
};

export function createPixelIcon(name, sizePx = 16) {
  const grid = GRIDS[name] || GRIDS.star;
  const rows = grid.length;
  const cols = grid[0].length;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${cols} ${rows}`);
  svg.setAttribute('width', String(sizePx));
  svg.setAttribute('height', String(Math.round((sizePx * rows) / cols)));
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('px-icon');

  for (let y = 0; y < rows; y++) {
    const row = grid[y];
    let x = 0;
    while (x < cols) {
      const ch = row[x];
      if (ch === '.' || !COLOR_MAP[ch]) {
        x++;
        continue;
      }
      let run = 1;
      while (x + run < cols && row[x + run] === ch) run++;
      const rect = document.createElementNS(SVG_NS, 'rect');
      rect.setAttribute('x', String(x));
      rect.setAttribute('y', String(y));
      rect.setAttribute('width', String(run));
      rect.setAttribute('height', '1');
      rect.setAttribute('fill', COLOR_MAP[ch]);
      svg.append(rect);
      x += run;
    }
  }
  return svg;
}
