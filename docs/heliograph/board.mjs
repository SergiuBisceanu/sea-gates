// The game engine uses cell centers as chart coordinates. The two extra
// columns at either end are the heliostat and the eastern channel mouths.
const COLS = 5, ROWS = 4, W = 750, H = 408;
const chartX = col => 141 + 81 * col;
const chartY = row => 83 + 77 * row;
const rayY = row => Math.min(352, Math.max(46, chartY(row)));
const NS = "http://www.w3.org/2000/svg";
const chartUrl = new URL("./assets/chart.webp", import.meta.url).href;
const ROMAN = ["I", "II", "III", "IV"];
let nextChart = 0;

function element(name, attrs = {}, content) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
  if (content !== undefined) node.textContent = content;
  return node;
}

function definitions(id) {
  return `<defs>
    <linearGradient id="${id}-sea" x2="1" y2=".85" gradientUnits="objectBoundingBox">
      <stop stop-color="#236164"/><stop offset=".43" stop-color="#154b51"/><stop offset=".82" stop-color="#10434c"/><stop offset="1" stop-color="#123b45"/>
    </linearGradient>
    <radialGradient id="${id}-shelf"><stop stop-color="#74a796" stop-opacity=".32"/><stop offset="1" stop-color="#538d78" stop-opacity="0"/></radialGradient>
    <linearGradient id="${id}-brass" x2=".7" y2="1" gradientUnits="objectBoundingBox">
      <stop stop-color="#fae6ac"/><stop offset=".25" stop-color="#ded090"/><stop offset=".49" stop-color="#ad7548"/><stop offset=".77" stop-color="#80553b"/><stop offset="1" stop-color="#504031"/>
    </linearGradient>
    <linearGradient id="${id}-glass" x2=".25" y2="1" gradientUnits="objectBoundingBox">
      <stop stop-color="#fff2c7"/><stop offset=".25" stop-color="#b9e0cb"/><stop offset=".48" stop-color="#68a398"/><stop offset=".77" stop-color="#346c69"/><stop offset="1" stop-color="#1d4749"/>
    </linearGradient>
    <linearGradient id="${id}-prism" x2=".75" y2="1" gradientUnits="objectBoundingBox">
      <stop stop-color="#f4deb3"/><stop offset=".35" stop-color="#b8c6ac"/><stop offset=".65" stop-color="#61938d"/><stop offset="1" stop-color="#377275"/>
    </linearGradient>
    <linearGradient id="${id}-stone" x2=".65" y2="1" gradientUnits="objectBoundingBox">
      <stop stop-color="#dac69c"/><stop offset=".4" stop-color="#b29d76"/><stop offset="1" stop-color="#75664e"/>
    </linearGradient>
    <radialGradient id="${id}-sun"><stop stop-color="#fffde1"/><stop offset=".23" stop-color="#ffdc83"/><stop offset="1" stop-color="#ebad48" stop-opacity="0"/></radialGradient>
    <pattern id="${id}-etch" patternUnits="userSpaceOnUse" width="35" height="31" patternTransform="rotate(-8)">
      <path d="M2 11q5 -2 9 -1m12 15q4 -1 8 -1m-19 -23l3 -.5" fill="none" stroke="#b5cfb5" stroke-opacity=".14" stroke-width=".85"/>
    </pattern>
    <pattern id="${id}-lines" patternUnits="userSpaceOnUse" width="4" height="4">
      <path d="M-1 3l4 -4m0 8l4 -4" fill="none" stroke="#654f3d" stroke-opacity=".29" stroke-width=".65"/>
    </pattern>
    <clipPath id="${id}-rim"><rect x="6" y="6" width="738" height="396" rx="7"/></clipPath>
  </defs>`;
}

function compass(x, y) {
  return `<g transform="translate(${x} ${y})" fill="none" stroke="#dfc995">
    <circle r="17" stroke-width=".7" opacity=".6"/><circle r="13" stroke-width=".6" opacity=".4"/>
    <path d="M0 -22v44m-22 -22h44m-13 -9l-18 18m0 -18l18 18" opacity=".5" stroke-width=".6"/>
    <path d="M0 -19L3 1l-3 -3 -3 3z" fill="#d9c28e" stroke-width=".6"/><path d="M0 19L2 2l-2 2 -2 -2z" fill="#335953" stroke-width=".6"/>
    <circle r="2.2" fill="#cbb483" stroke-width=".6"/>
    <text y="-26" text-anchor="middle" font-family="Georgia,serif" fill="#dfc995" stroke="none" font-size="8">N</text>
  </g>`;
}

function mapBase(id) {
  const coast = "M-8 -8H84L73 12 58 18 56 24 45 27 37 38 36 47 23 57 17 65 6 69 -8 85Z";
  const lowerCoast = "M-12 347L9 349 22 359 34 359 39 369 54 373 62 371 72 379 83 382 94 397 122 405 132 418H-12Z";
  let ticks = "", grid = "", laneMarks = "";
  for (let x = 17; x < 740; x += 12) {
    const major = (x - 17) % 60 === 0;
    ticks += `<path d="M${x} 7v${major ? 5 : 2}m0 ${major ? 389 : 395}v-${major ? 5 : 2}"/>`;
  }
  for (let row = 0; row < ROWS; row++) {
    const y = chartY(row);
    grid += `<path d="M84 ${y}H710" stroke="#d8d1a3" opacity=".29" stroke-dasharray="1 5"/>
      <path d="M535 ${y-18}h154m-154 36h154" stroke="#b0c4ae" opacity=".16" stroke-dasharray="7 4 1 4"/>`;
    laneMarks += `<g transform="translate(${chartX(COLS)} ${y})" stroke="#c4b58a" opacity=".67" fill="none">
      <path d="M-7 -6h-3v12h3m14 -12h3v12h-3" stroke-width="1"/><circle r="2.2" stroke-width=".85"/>
      </g><g transform="translate(709 ${y})"><path d="M-10 0l3 -5h14l3 5 -3 5H-7Z" fill="#113e44" stroke="#bda777" stroke-width=".7"/><text text-anchor="middle" y="2.8" class="hg-lane-no">${ROMAN[row]}</text></g>`;
  }
  for (let col = 0; col < COLS; col++) {
    const x = chartX(col);
    grid += `<path d="M${x} 49V346" stroke="#c0c7a5" opacity=".20" stroke-dasharray="1 5"/>
      <text x="${x}" y="34" class="hg-coordinate" text-anchor="middle">${col+1}</text>`;
  }
  let contours = "";
  for (let i = 0; i < 6; i++) {
    contours += `<path d="M${85+i*10} 3q-10 ${25+i} -41 ${36+i}t-49 ${44+i}" />
      <path d="M4 ${328-i*5}q28 -1 49 23t44 26 40 19" />`;
  }
  return `<rect x="1" y="1" width="748" height="406" rx="9" fill="#142d32" stroke="#6d6952" stroke-width="2"/>
    <g clip-path="url(#${id}-rim)">
    <rect width="750" height="408" fill="url(#${id}-sea)"/>
    <ellipse cx="98" cy="72" rx="237" ry="138" fill="url(#${id}-shelf)"/>
    <ellipse cx="17" cy="348" rx="245" ry="143" fill="url(#${id}-shelf)"/>
    <rect width="750" height="408" fill="url(#${id}-etch)"/>
    <g fill="none" stroke="#b9ccac" stroke-width=".75" opacity=".23">${contours}</g>
    <g fill="none" stroke="#cfcea6" opacity=".12" stroke-width=".75">
      <path d="M-25 219l315 -235m-315 235l780 -200m-780 200l775 77m-775 -77l653 207"/>
      <path d="M694 -32l-117 151c-44 60 -43 143 -128 190s-79 68 -121 115m384 -452l-120 153c-44 57 -46 145 -129 193s-83 69 -119 114"/>
    </g>
    <g fill="#87a694" opacity=".48"><path d="${coast}" transform="translate(4 6)"/><path d="${lowerCoast}" transform="translate(3 -4)"/></g>
    <g fill="url(#${id}-stone)" stroke="#ccb995" stroke-width="1.1"><path d="${coast}"/><path d="${lowerCoast}"/></g>
    <g fill="url(#${id}-lines)"><path d="${coast}"/><path d="${lowerCoast}"/></g>
    <g fill="#6a755d" opacity=".7"><path d="M8 25l9 -14 3 7 6 -10 8 9m-27 348l7 -9 5 9 5 -6 6 12"/></g>
    <image href="${chartUrl}" width="750" height="408" preserveAspectRatio="xMidYMid slice" opacity=".89"/>
    <g fill="none" stroke-width=".8">${grid}</g>
    <g class="hg-chart-label" fill="#c5ccb1">
      <text x="52" y="38" text-anchor="middle" transform="rotate(-32 52 38)">AKRA</text>
      <text x="624" y="34" text-anchor="middle" letter-spacing="2.2">EASTERN ROADSTEAD</text>
    </g>
    ${laneMarks}
    ${compass(684,367)}
    <g class="hg-scale" stroke="#b9b78e" fill="none" stroke-width=".9">
      <path d="M82 370h84m-84 -3v6m21 -5v4m21 -5v6m21 -5v4m21 -5v6"/>
      <path d="M83 371h20m22 0h20" stroke-width="2"/>
    </g>
    <g class="hg-chart-label"><text x="82" y="385">OPTICAL SURVEY</text>
      <text x="470" y="383" fill="#a7b9a5" text-anchor="middle" letter-spacing="2.3">AEGAEUM MARE</text></g>
    <g fill="none" stroke="#c3ac77" opacity=".53" stroke-width=".7">${ticks}</g>
    </g>
    <rect x="6" y="6" width="738" height="396" rx="7" fill="none" stroke="#a58c61" stroke-width=".9"/>
    <rect x="10" y="10" width="730" height="388" rx="5" fill="none" stroke="#b6aa7e" opacity=".23" stroke-width=".6"/>`;
}

function disk(id) {
  let ticks = "";
  for (let i = 0; i < 12; i++) {
    ticks += `<path d="M0 -26v${i%3 ? 2 : 4}" transform="rotate(${i * 30})"/>`;
  }
  return `<ellipse cx="1" cy="6" rx="29" ry="24" fill="#0c3036" opacity=".65"/>
    <ellipse cy="3" rx="26" ry="24" fill="#514c3b" stroke="#183a3d" stroke-width="1.4"/>
    <ellipse rx="25" ry="23" fill="#436460" stroke="#c5a874" stroke-width="1.4"/>
    <ellipse rx="20.5" ry="19" fill="#2e5354" stroke="#99a48c" stroke-width=".8"/>
    <path d="M-23 1a23 23 0 0 1 40 -16" fill="none" stroke="#d8c39a" stroke-width="1.2"/>
    <g stroke="#d9c295" opacity=".85" stroke-width=".85">${ticks}</g>
    <circle r="4.1" fill="url(#${id}-brass)" stroke="#233c3d"/>`;
}

function optic(id, kind) {
  if (kind === "mirror") return `<g class="hg-optic-body">
    <path d="M-28 5L25 5l3 -6h-55z" fill="#4a4134" opacity=".94"/>
    <path d="M-27 -4h53l1 8h-54z" fill="url(#${id}-brass)" stroke="#443f33" stroke-width="1.25"/>
    <path d="M-24 -5h48l-2 6h-43z" fill="url(#${id}-glass)" stroke="#e1d8af" stroke-width="1"/>
    <path d="M-21 -3h39" fill="none" stroke="#eff5d6" stroke-width="1.25"/>
    <path d="M-17 1h32" fill="none" stroke="#437673" stroke-width="1"/>
    <g fill="url(#${id}-brass)" stroke="#61513c" stroke-width="1">
      <path d="M-29 -6h5v11h-5z"/><path d="M24 -6h5v11h-5z"/>
    </g><path d="M-28 -4h2m23 3l5 -2m20 -1h2" stroke="#ffedc2" stroke-width="1"/>
  </g>`;
  return `<g class="hg-optic-body">
    <path d="M-25 7L0 -14 25 7 0 16Z" fill="#344747" stroke="#6d553a" stroke-width="2"/>
    <path d="M-26 2L0 -17 25 2 0 12Z" fill="url(#${id}-prism)" stroke="#dfc28c" stroke-width="1.5"/>
    <path d="M0 -17L-1 1 0 12 -26 2Z" fill="#92b5a2" opacity=".8"/>
    <path d="M0 -17L25 2 -1 1Z" fill="#e4dcb9" opacity=".9"/>
    <path d="M-24 2l23 -1 25 1m-25 -1l1 11" fill="none" stroke="#f5e5b8" stroke-width=".95"/>
    <path d="M-18 6h36" stroke="#e6c58b" stroke-width="1.6"/>
    <circle cx="-26" cy="2" r="2" fill="#e8c493"/><circle cx="25" cy="2" r="2" fill="#e8c493"/>
  </g>`;
}

function heliostat(id) {
  return `<g aria-hidden="true">
    <ellipse cy="11" rx="29" ry="12" fill="#123c42" opacity=".7"/>
    <path d="M-25 5l8 -10 24 -1 16 10 -8 9 -26 1z" fill="url(#${id}-stone)" stroke="#4f554a" stroke-width="1.4"/>
    <path d="M-23 5l21 3 22 -5m-24 5v7m-9 -8l-2 6" fill="none" stroke="#796e56" stroke-width="1"/>
    <path d="M-9 5l3 -21h11l3 21 -8 3z" fill="url(#${id}-brass)" stroke="#4a473c" stroke-width="1.3"/>
    <ellipse cy="-15" rx="11" ry="4" fill="#956747" stroke="#dbbf8b"/>
    <g transform="translate(-1 -8) rotate(-14)">
      <ellipse rx="13" ry="19" fill="#553f32" stroke="#c59e66" stroke-width="2"/>
      <ellipse cx="2" rx="11" ry="17" fill="url(#${id}-glass)" stroke="#f2daa1" stroke-width="1.5"/>
      <path d="M-3 -13q-5 6 -4 12" fill="none" stroke="#fff1cc" stroke-width="1.5"/>
    </g>
    <path d="M4 -8l17 6 -2 4 -15 -5Z" fill="url(#${id}-brass)" stroke="#5c513b" stroke-width=".9"/>
    <circle cx="19" r="12" fill="url(#${id}-sun)"/><circle cx="19" r="2.7" fill="#fff8cc"/>
  </g>`;
}

const FLEET = {
  skiff: { length: 36, half: 7, oars: 2, sail: "#d4c29b", stripe: "#8c6349", title: "Skiff" },
  raider: { length: 45, half: 8, oars: 4, sail: "#b2674e", stripe: "#f2d39e", title: "Raider" },
  ironclad: { length: 48, half: 10, oars: 4, sail: "#69888a", stripe: "#d6c497", title: "Ironclad" },
  flagship: { length: 55, half: 11, oars: 5, sail: "#955465", stripe: "#e6c081", title: "Flagship" },
};

function vessel(ship, id) {
  const type = ship.kind || (ship.boss ? "flagship" : "skiff");
  const { length, half: b, oars, sail, stripe } = FLEET[type] || FLEET.skiff;
  const l = length / 2;
  let blades = "", rivets = "";
  for (let i = 0; i < oars; i++) {
    const x = -l*.57 + i*l*1.06/(oars-1);
    blades += `<path d="M${x} ${-b+2}l5 -7m-5 ${b*2+3}l5 7" stroke="#caad78" stroke-width="1.15"/>`;
    if (type === "ironclad" || type === "flagship") {
      rivets += `<ellipse cx="${x}" cy="${b-1}" rx="2.2" ry="2.5" fill="#809f99" stroke="#edd39b" stroke-width=".7"/>`;
    }
  }
  const mast = type === "skiff" ? -2 : 0;
  return `<g class="hg-ship-moving"><g class="hg-ship-bob">
    <g class="hg-wake" fill="none" stroke="#9abcae" stroke-linecap="round">
      <path d="M${l-2} 2q8 -2 13 0t13 1m-20 3q7 -1 12 1" stroke-width="1.15" opacity=".72"/>
      <path d="M${l-4} -4q11 -6 20 -4m-16 15q12 5 20 4" opacity=".47"/>
    </g>
    <g class="hg-oars">${blades}</g>
    <path d="M${-l-4} 0Q${-l*.30} ${-b-4} ${l-3} ${-b+1}l3 4 -1 8Q${-l*.2} ${b+6} ${-l-4} 0Z" fill="#2a3737" stroke="#142d31" stroke-width="1.5"/>
    <path d="M${-l} 0Q${-l*.23} ${-b-1} ${l-4} ${-b+3}l1 8Q${-l*.25} ${b+2} ${-l} 0Z" fill="${type==="ironclad" ? "#687e79" : "#b18a5e"}" stroke="#d6b582" stroke-width="1"/>
    <path d="M${-l+5} 0Q-2 ${-b+2} ${l-7} ${-b+5}L${l-6} 3Q-3 ${b-1} ${-l+5} 0Z" fill="#71563f" stroke="#433c32" stroke-width="1"/>
    <path d="M${-l-5} 0l7 -4 -1 4m${l*1.6} -2l3 -5" fill="none" stroke="#e9c389" stroke-width="1.4"/>
    ${rivets}
    <g transform="translate(${mast} -3)">
      <path d="M-3 -14L3 7" stroke="#443e32" stroke-width="2.6"/><path d="M-3 -14L3 7" stroke="#d5b279" stroke-width="1"/>
      <path d="M-7 -13q7 -1 14 1q-5 7 -2 16q-8 -1 -15 -4q5 -5 3 -13Z" fill="${sail}" stroke="#524c40" stroke-width="1.1"/>
      <path d="M-6 -11q5 -1 10 0m-10 2q0 6 -2 8" fill="none" stroke="${stripe}" stroke-width="1.3"/>
      ${type==="raider" ? '<path d="M-2 -11q1 5 -2 12" fill="none" stroke="#e9d5a9" stroke-width="2"/>' : ""}
      ${type==="ironclad" ? '<path d="M-3 -9h5v5l-3 3 -3 -4z" fill="#d9c89a"/>' : ""}
      ${type==="flagship" ? '<path d="M-1 -10l1 3 3 1 -3 1 -1 3 -1 -3 -3 -1 3 -1z" fill="#f5d79d"/>' : ""}
    </g>
    ${type==="flagship" ? '<path d="M11 1v-20m0 0l12 3 -6 2 -6 -1z" fill="#e1b56f" stroke="#5b4738" stroke-width="1.1"/>' : ""}
  </g></g>`;
}

function shortLabel(row, col, piece) {
  return `Column ${col+1}, channel ${ROMAN[row]}, ${piece.kind === "splitter" ? "fork prism" : "mirror"}, ${piece.tilt === "/" ? "rises right" : "falls right"}. Rotate one quarter turn.`;
}

// One instance owns its SVG, event listeners and stable focusable optic nodes.
export class HeliographBoard {
  constructor(container, handlers = {}) {
    this.container = container;
    this.handlers = handlers;
    this.id = "hgmap-" + (++nextChart);
    this.svg = element("svg", { viewBox: `0 0 ${W} ${H}`, class: "hg-board", role: "group",
      "aria-label": "Heliograph optical chart, five columns and four sea lanes" });
    this.svg.innerHTML = definitions(this.id) + `<g aria-hidden="true">${mapBase(this.id)}</g>`;
    this.beam = element("g", { class: "hg-rays", "aria-hidden":"true" });
    this.suggestion = element("g", { class:"hg-suggestion", "aria-hidden":"true" });
    this.stations = element("g");
    this.source = element("g", { class: "hg-source", "aria-hidden":"true" });
    this.source.innerHTML = heliostat(this.id);
    this.fleet = element("g", { class:"hg-fleet", role:"group", "aria-label":"Incoming fleet" });
    this.shots = element("g", { class: "hg-volley-fx", "aria-hidden":"true" });
    this.svg.append(this.beam, this.suggestion, this.stations, this.source, this.fleet, this.shots);
    this.container.replaceChildren(this.svg);
    this.tiles = new Map();
    this.rayKey = this.fleetKey = this.volleyKey = null;
    this.click = event => {
      const tile = event.target.closest?.("[data-optic]");
      if (!tile || this.view?.locked || tile.getAttribute("aria-disabled") === "true") return;
      const index = Number(tile.dataset.optic);
      tile.focus({preventScroll:true});
      this.select(index);
      this.handlers.onRotate?.(index);
    };
    this.focus = event => {
      const tile = event.target.closest?.("[data-optic]");
      if (tile && !this.view?.locked) this.select(Number(tile.dataset.optic));
    };
    this.key = event => this.keyDown(event);
    this.svg.addEventListener("click",this.click);
    this.svg.addEventListener("focusin",this.focus);
    this.svg.addEventListener("keydown",this.key);
  }

  select(index) {
    if (index !== this.view?.selected) this.handlers.onSelect?.(index);
  }

  keyDown(event) {
    const tile = event.target.closest?.("[data-optic]");
    if (!tile || this.view?.locked) return;
    const index = Number(tile.dataset.optic), row = Math.floor(index/COLS), col = index%COLS;
    if (event.key === "Enter" || event.key === " " || event.key === "Spacebar") {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat && !this.view.locked && tile.getAttribute("aria-disabled") !== "true") this.handlers.onRotate?.(index);
      return;
    }
    const steps = { ArrowLeft:[0,-1], ArrowRight:[0,1], ArrowUp:[-1,0], ArrowDown:[1,0] };
    const delta = steps[event.key];
    let next = null;
    if (delta) {
      let r=row+delta[0], c=col+delta[1];
      while (r>=0 && c>=0 && r<ROWS && c<COLS) {
        const candidate = this.tiles.get(r*COLS+c);
        if (candidate?.kind) { next = candidate.el; break; }
        r+=delta[0]; c+=delta[1];
      }
      if (!next) {
        const ordered = [...this.tiles.keys()].filter(i => this.tiles.get(i).kind);
        const step = delta[0] + delta[1];
        const pos = (ordered.indexOf(index) + step + ordered.length) % ordered.length;
        next = this.tiles.get(ordered[pos])?.el;
      }
    } else if (event.key === "Home" || event.key === "End") {
      const keys = [...this.tiles.values()].filter(tile => tile.kind);
      next = (event.key === "Home" ? keys[0] : keys.at(-1))?.el;
    } else return;
    event.preventDefault();
    event.stopPropagation();
    next?.focus({preventScroll:true});
  }

  render(view) {
    if (!view?.state) return;
    this.view = view;
    const { state, trace, selected, hint, locked, volley } = view;
    this.svg.classList.toggle("hg-locked",Boolean(locked));
    const sourceY=chartY(state.sourceRow);
    this.source.setAttribute("transform",`translate(${chartX(-1)-19} ${sourceY})`);
    let tabbable = selected;
    if (tabbable == null || !state.board[Math.floor(tabbable/COLS)]?.[tabbable%COLS]) {
      const first = state.board.flat().findIndex(Boolean);
      tabbable = first < 0 ? null : first;
    }
    for (let row=0;row<ROWS;row++) for(let col=0;col<COLS;col++) {
      const index = row*COLS+col, piece=state.board[row][col], kind=piece?.kind || null;
      let tile=this.tiles.get(index);
      if (!tile) {
        const el=element("g",{ transform:`translate(${chartX(col)} ${chartY(row)})` });
        this.stations.append(el);
        tile={el,kind:undefined};this.tiles.set(index,tile);
      }
      if (tile.kind!==kind) {
        tile.kind=kind;
        if (kind) {
          tile.el.innerHTML = `<rect class="hg-hit" x="-39" y="-37" width="78" height="74" fill="transparent"/>
            <g aria-hidden="true"><circle class="hg-halo" r="32"/>${disk(this.id)}
            <g class="hg-rotor">${optic(this.id,kind)}</g>
            <g class="hg-focus-brackets" fill="none" stroke="#f6d18e" stroke-width="1.6">
              <path d="M-33 -19v-11h11m44 0h11v11m0 38v11h-11m-44 0h-11v-11"/>
            </g></g>`;
          tile.rotor=tile.el.querySelector(".hg-rotor");
          tile.el.setAttribute("role","button");
          tile.el.setAttribute("data-optic",index);
          tile.el.removeAttribute("aria-hidden");
        } else {
          tile.el.innerHTML = '<g fill="none" stroke="#d3cda1" opacity=".40" stroke-width=".8"><circle r="1.9"/><path d="M-7 0h3m8 0h3M0 -7v3m0 8v3"/></g>';
          for(const attr of ["class","role","data-optic","tabindex","aria-label","aria-disabled"]) tile.el.removeAttribute(attr);
          tile.el.setAttribute("aria-hidden","true");
        }
      }
      if (!piece) continue;
      tile.el.setAttribute("class",`hg-tile ${index===selected?"hg-selected":""} ${index===hint?"hg-hint":""}`);
      tile.el.setAttribute("aria-label",shortLabel(row,col,piece));
      tile.el.setAttribute("aria-disabled",String(Boolean(locked) || state.orders <= 0 || state.phase !== "planning"));
      tile.el.setAttribute("tabindex",index===tabbable?"0":"-1");
      tile.rotor.style.transform=`rotate(${piece.tilt==="/" ? -45:45}deg)`;
    }
    this.drawRays(trace, state.sourceRow);
    this.drawSuggestion(!locked && hint != null ? view.suggestedTrace : null, trace);
    this.drawFleet(state);
    this.drawVolley(volley);
  }

  drawRays(trace, sourceRow) {
    const paths = trace?.segments || [];
    const key = sourceRow + ":" + paths.map(s=>[s.x1,s.y1,s.x2,s.y2,s.power].join(",")).join(";");
    if(key===this.rayKey)return;
    this.rayKey=key;this.beam.replaceChildren();
    for (const s of paths) {
      const x1=chartX(s.x1), x2=chartX(s.x2), y1=rayY(s.y1), y2=rayY(s.y2);
      const d=`M${x1} ${y1}L${x2} ${y2}`, power=Math.max(0.5,Math.min(4,s.power));
      const group=element("g",{class:"hg-ray", fill:"none","stroke-linecap":"round"});
      group.append(
        element("path",{d,stroke:"#f6ab4a","stroke-width":3+power*1.5,opacity:.12+power*.017}),
        element("path",{d,stroke:"#f4bd6b","stroke-width":1+power*.48,opacity:.75}),
        element("path",{d,stroke:"#fff1b3","stroke-width":.6+power*.23,opacity:.91}),
        element("path",{d,stroke:"#fff9cf","stroke-width":1.6,class:"hg-ray-glint","stroke-dasharray":"2 33",opacity:.82})
      );
      this.beam.append(group);
    }
    for(let row=0;row<ROWS;row++){
      const power=trace?.ports?.[row] || 0;
      if(!power)continue;
      const x=chartX(COLS),y=chartY(row);
      this.beam.append(element("path",{d:`M${x} ${y}h13`,stroke:"#fada86","stroke-width":2,opacity:.8}));
      this.beam.append(element("path",{d:`M${x+14} ${y}h34`,stroke:"#f5d28c","stroke-width":1.2,"stroke-dasharray":"1.5 4",opacity:.67}));
      this.beam.append(element("circle",{cx:x,cy:y,r:7+power,fill:`url(#${this.id}-sun)`}));
      this.beam.append(element("circle",{cx:x,cy:y,r:3.2,fill:"#fff0ad",stroke:"#e2ab63","stroke-width":1}));
    }
  }

  drawSuggestion(suggestion, current) {
    // Keep the live ray solid. Draw just the lengths the next order adds,
    // even if the preview approaches an existing length from the other side.
    const segmentKey = s => {
      const a = `${s.x1},${s.y1}`, b = `${s.x2},${s.y2}`;
      return a < b ? `${a}:${b}` : `${b}:${a}`;
    };
    const live = new Set((current?.segments || []).map(segmentKey));
    const paths = (suggestion?.segments || []).filter(s => !live.has(segmentKey(s)));
    const key = paths.map(segmentKey).join(";");
    if (key === this.suggestionKey) return;
    this.suggestionKey = key;
    this.suggestion.replaceChildren();
    for(const s of paths) {
      this.suggestion.append(element("path",{d:`M${chartX(s.x1)} ${rayY(s.y1)}L${chartX(s.x2)} ${rayY(s.y2)}`,
        stroke:"#b7e2d6", "stroke-width":1.8, fill:"none", "stroke-linecap":"round", "stroke-dasharray":"4 5", opacity:.91}));
    }
  }

  drawFleet(state) {
    const fleetKey = state.tide + ":" + state.ships.map(ship=>[ship.row,ship.kind,ship.name,ship.hp,ship.boss].join(",")).join(";");
    if(fleetKey===this.fleetKey)return;
    this.fleetKey=fleetKey;this.fleet.replaceChildren();
    for(const ship of state.ships){
      const y=chartY(ship.row),x=617;
      const kind=ship.kind || (ship.boss?"flagship":"skiff");
      const group=element("g",{class:"hg-vessel",transform:`translate(${x} ${y})`,"data-ship-row":ship.row,role:"img",
        "aria-label":`${ship.name || FLEET[kind]?.title || "Vessel"}, channel ${ROMAN[ship.row]}, ${ship.hp} hull, ${ship.breach} gate damage`});
      group.style.setProperty("--ship-phase",(-ship.row*.58)+"s");
      group.innerHTML = vessel(ship,this.id);
      const label=element("g",{class:"hg-hull-plate", "aria-hidden":"true"});
      label.append(element("rect",{x:-16,y:18,width:32,height:12,rx:3,fill:"#16373c",stroke:"#998962","stroke-width":.7}));
      label.append(element("path",{d:"M-10 24l3 -4 3 4 -3 3z",fill:"#dfb67d"}));
      label.append(element("text",{x:3,y:27,"text-anchor":"middle",class:"hg-hull-text"},String(ship.hp)));
      group.append(label);this.fleet.append(group);
    }
  }

  drawVolley(volley) {
    const key=volley?.id ?? null;
    if(key===this.volleyKey)return;
    this.volleyKey=key;this.shots.replaceChildren();
    this.svg.classList.toggle("hg-volley",Boolean(volley));
    for(const vessel of this.fleet.children)vessel.classList.remove("hg-sunk","hg-breach");
    if (!volley?.result)return;
    for(const ship of volley.result.ships){
      const row=ship.row, power=volley.result.ports?.[row]||0;
      const y=chartY(row), x=617, mouth=chartX(COLS);
      const vessel=this.fleet.querySelector(`[data-ship-row="${row}"]`);
      vessel?.classList.add(ship.sunk?"hg-sunk":"hg-breach");
      if(power>0){
        const strike=element("g",{class:"hg-strike","aria-hidden":"true"});
        strike.innerHTML=`<path class="hg-strike-glow" d="M${mouth} ${y}H${x-2}" stroke="#ffbd68" stroke-width="8" opacity=".48"/>
          <path d="M${mouth} ${y}H${x-2}" stroke="#fff1bc" stroke-width="2.8"/>
          <g class="hg-hit-flash" transform="translate(${x-4} ${y})"><circle r="23" fill="url(#${this.id}-sun)"/>
          <path d="M-14 -6l-7 -4m15 -2l-3 -9m15 12l8 -10m0 14l10 -2m-12 8l6 6" stroke="#f5d69c" stroke-width="1.5"/></g>`;
        this.shots.append(strike);
      }
      if (ship.sunk) {
        const wreck=element("g",{class:"hg-wreck",transform:`translate(${x} ${y})`});
        wreck.innerHTML='<g class="hg-wreck-spread"><ellipse rx="25" ry="8" fill="none" stroke="#a8cbbb" stroke-width="1.5"/><path d="M-12 -2l8 2m7 -4l5 3m-7 5l5 1" stroke="#ccaa75" stroke-width="1.8"/></g>';
        this.shots.append(wreck);
      } else {
        const breach=element("g",{class:"hg-breach-mark",transform:`translate(${chartX(-1)} ${y})`});
        breach.innerHTML='<g><path d="M-11 -8l5 3 4 -7 2 7 9 -4 -4 7 6 4 -8 0 0 7 -5 -5 -6 5 2 -7 -7 -2 7 -3z" fill="#d18b64" stroke="#f4d5a0" stroke-width=".8"/></g>';
        this.shots.append(breach);
      }
    }
  }

  destroy() {
    this.svg.removeEventListener("click",this.click);
    this.svg.removeEventListener("focusin",this.focus);
    this.svg.removeEventListener("keydown",this.key);
    this.svg.remove();this.tiles.clear();this.view=null;
  }
}
