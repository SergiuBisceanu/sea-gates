import { weaponRange } from "./engine.mjs";

const NS = "http://www.w3.org/2000/svg";
export const BATTLE_DURATION = 3400;
const COLS = 8, ROWS = 6, SIZE = 68, GRID_X = 28, GRID_Y = 43;
const WATER = new Set([2, 5]);
const xAt = col => GRID_X + SIZE * (col + 0.5);
const yAt = row => GRID_Y + SIZE * (row + 0.5);
const isLand = index => index >= 0 && index < 48 && !WATER.has(index % 8);
const nameOf = kind => ({timber:"Timber",stone:"Limestone",bronze:"Bronze",wine:"Wine",
  ballista:"Ballista",catapult:"Stone catapult",claw:"Archimedean claw",siphon:"Fire siphon"})[kind] || kind;
const isMachine = piece => piece && piece.tier > 0;
let nextId = 0;
const harborUrl = new URL("./assets/harbor.webp", import.meta.url).href;

function shipOrdinal(id) {
  let hash = 0;
  for (const character of String(id)) hash = (Math.imul(hash, 31) + character.charCodeAt(0)) >>> 0;
  return hash;
}

function node(tag, attributes = {}, content) {
  const el = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
  if (content !== undefined) el.textContent = content;
  return el;
}
function gradients(id) {
  return `<defs>
    <linearGradient id="${id}-sea" x2=".6" y2="1"><stop stop-color="#1c6168"/><stop offset=".42" stop-color="#15515d"/><stop offset="1" stop-color="#123d4a"/></linearGradient>
    <linearGradient id="${id}-stone" x2=".75" y2="1"><stop stop-color="#e6d6af"/><stop offset=".35" stop-color="#ccbb94"/><stop offset="1" stop-color="#9d8f70"/></linearGradient>
    <linearGradient id="${id}-wood" x2=".8" y2=".4"><stop stop-color="#e0ae6a"/><stop offset=".45" stop-color="#a86a3e"/><stop offset=".76" stop-color="#7c4b30"/><stop offset="1" stop-color="#4d372d"/></linearGradient>
    <linearGradient id="${id}-bronze" x2=".55" y2="1"><stop stop-color="#ffe3a2"/><stop offset=".27" stop-color="#d7a965"/><stop offset=".58" stop-color="#bd8248"/><stop offset="1" stop-color="#725034"/></linearGradient>
    <linearGradient id="${id}-wine" x2=".72" y2=".8"><stop stop-color="#e0a173"/><stop offset=".32" stop-color="#c0684c"/><stop offset=".67" stop-color="#994639"/><stop offset="1" stop-color="#633830"/></linearGradient>
    <linearGradient id="${id}-iron" x2=".3" y2="1"><stop stop-color="#c0c9b6"/><stop offset=".4" stop-color="#829b92"/><stop offset="1" stop-color="#435b59"/></linearGradient>
    <radialGradient id="${id}-flare"><stop stop-color="#fff9d3"/><stop offset=".24" stop-color="#f9cc71"/><stop offset="1" stop-color="#e5aa56" stop-opacity="0"/></radialGradient>
    <pattern id="${id}-sea-lines" width="55" height="38" patternUnits="userSpaceOnUse"><path d="M1 9q7 -3 15 0m13 22q8 -4 18 -1m-40 -7l3 -1m23 -20l6 -1" fill="none" stroke="#9fc5b6" stroke-opacity=".19" stroke-width="1"/></pattern>
    <pattern id="${id}-masonry" width="34" height="21" patternUnits="userSpaceOnUse"><path d="M0 21h34M0 0v21m34 0V0M17 0v10M0 10h34m-8 0v11" fill="none" stroke="#6e725e" stroke-width=".7" opacity=".45"/></pattern>
    <clipPath id="${id}-board-clip"><rect x="13" y="6" width="574" height="488" rx="8"/></clipPath>
    <clipPath id="${id}-range-water"><rect x="${GRID_X+2*SIZE}" y="6" width="${SIZE}" height="488"/><rect x="${GRID_X+5*SIZE}" y="6" width="${SIZE}" height="488"/></clipPath>
  </defs>`;
}

function scenery(id) {
  let piers="", channels="", squares="", marks="";
  for (const col of [0,3,6]) {
    const x=GRID_X+col*SIZE;
    piers+=`<path d="M${x+4} ${GRID_Y-8}h128l4 8v405l-8 6h-118l-10 -6V${GRID_Y}Z" fill="#1c3437" opacity=".6" transform="translate(2 6)"/>
      <path d="M${x+4} ${GRID_Y-8}h128l4 8v405l-8 6h-118l-10 -6V${GRID_Y}Z" fill="#8b917a" stroke="#d3c49b" stroke-width="1.1"/>
      <path d="M${x+2} ${GRID_Y}v400m132 -399v398" stroke="#eee2bd" opacity=".62" stroke-width="2"/>`;
  }
  for(let row=0;row<6;row++) for(let col=0;col<8;col++) {
    if(WATER.has(col))continue;
    const x=GRID_X+col*SIZE,y=GRID_Y+row*SIZE;
    const color=["#c9bc97","#b9af8e","#d0c3a0","#c2b798"][(row*3+col)%4];
    squares+=`<g><path d="M${x+5} ${y+2}h55l6 4v55l-5 5H${x+6}l-5 -5V${y+7}Z" fill="${color}" stroke="#8c8b71" stroke-width=".9"/>
      <path d="M${x+9} ${y+4}h49m-54 5v43" stroke="#ebe0bc" stroke-width=".8" opacity=".8"/>
      <path d="M${x+11} ${y+20}l8 -2 4 -7m-4 7l5 4m24 35l7 -7 8 0" fill="none" stroke="#8d8d73" opacity=".36" stroke-width=".8"/>
      <path d="M${x+6} ${y+61}h51" stroke="#91896c" stroke-width="1.1" opacity=".7"/>
    </g>`;
  }
  for(const col of [2,5]) {
    const x=GRID_X+col*SIZE;
    channels+=`<g><path d="M${x+4} 7v487m60 -487v487" stroke="#75aaa1" opacity=".45" stroke-width="1"/>
      <g class="hw-current"><path d="M${x+13} 33q12 -5 22 -1m-14 43q8 3 22 -1m-28 53q14 -4 29 1m-32 58q10 4 22 0m-21 57q7 -5 24 -1m-30 48q10 4 27 1m-29 57q13 -5 29 0m-32 50q12 5 24 0m-17 49q8 -3 22 -1" fill="none" stroke="#a4cbb9" stroke-width="1.25" opacity=".34"/></g>
      <path d="M${x+7} 39v402m54 -402v402" stroke="#a6bfa3" stroke-width="2" stroke-dasharray="4 11 1 15" opacity=".32"/>
    </g>`;
    marks+=`<g><path d="M${x+28} 17l6 7 6 -7" stroke="#d9ce9e" fill="none" stroke-width="1.4" opacity=".7"/>
      <text x="${x+34}" y="36" text-anchor="middle" class="hw-lane-label">${col===2?"WEST":"EAST"}</text></g>`;
  }
  let wall="";
  for(const [x,w] of [[29,136],[233,136],[437,135]])wall+=`<path d="M${x} 459v-6h11v6h12v-6h11v6h12v-6h11v6h12v-6h11v6h12v-6h11v6h11v33H${x}Z" fill="url(#${id}-stone)" stroke="#777e69"/>
    <rect x="${x}" y="466" width="${w-3}" height="26" fill="url(#${id}-masonry)"/>
    <path d="M${x+2} 465h${w-7}" stroke="#e9dcbb" stroke-width="1.8"/>`;
  return `<rect x="7" y="1" width="586" height="498" rx="11" fill="#1a373c" stroke="#7b866c" stroke-width="1.4"/>
    <g clip-path="url(#${id}-board-clip)"><rect width="600" height="500" fill="url(#${id}-sea)"/>
    <image href="${harborUrl}" width="600" height="500" preserveAspectRatio="xMidYMid slice" opacity=".37"/>
    <rect width="600" height="500" fill="url(#${id}-sea-lines)"/>
    <g fill="none" stroke="#91b5a5" stroke-width=".65" opacity=".15"><path d="M-15 118Q85 52 192 28T590 48M-15 107Q85 41 192 17T590 37M-15 96Q85 30 192 6T590 26"/></g>
    ${channels}${piers}${squares}${wall}${marks}
    <path d="M170 471q28 -25 56 0m148 0q28 -25 56 0" stroke="#918d70" stroke-width="5" fill="none"/>
    <path d="M171 469q27 -21 54 0m150 0q27 -21 54 0" stroke="#ddcda5" stroke-width="1.5" fill="none"/>
    <path d="M184 487h28m176 0h28" stroke="#92b9ab" opacity=".7" stroke-dasharray="3 3"/>
    </g><rect x="13" y="6" width="574" height="488" rx="8" fill="none" stroke="#bfb58c" stroke-width=".8" opacity=".6"/>`;
}

function resource(kind,id) {
  if(kind==="stone") return `<g>
    <path d="M-24 12l19 -11 28 8 -18 17z" fill="#495554" opacity=".2" transform="translate(2 6)"/>
    <path d="M-24 -5l21 -12 27 9 -20 13z" fill="#f1e6c7" stroke="#8c8266" stroke-width="1.3"/>
    <path d="M-24 -5L4 5v22l-28 -11z" fill="#c4b18b" stroke="#8c8266" stroke-width="1.3"/>
    <path d="M4 5L24 -8v23L4 27z" fill="#a69c7b" stroke="#8c8266" stroke-width="1.3"/>
    <path d="M-23 -3l26 9m-19 -3l0 13m12 -9l-1 15M7 7l13 -8m-11 10v13" stroke="#e7dcc0" fill="none" stroke-width="1"/>
    <path d="M-9 -13l1 7 9 3m-10 -3l-9 4m36 -6l-4 8 3 4m-9 -3l-3 13" fill="none" stroke="#b8ad8d" stroke-width="1.1"/>
    <path d="M-23 15l25 10" stroke="#988c6c" stroke-width="1.2"/>
  </g>`;
  if(kind==="timber") return `<g transform="translate(-1 2)">
    <ellipse cx="1" cy="19" rx="27" ry="9" fill="#4d574a" opacity=".2"/>
    ${[-12,0,12].map((x,i)=>`<g transform="translate(${x} ${i===1?-4:2})">
      <path d="M-8 -15l11 -7 14 31 -12 11L-8 6z" fill="url(#${id}-wood)" stroke="#6a4a35" stroke-width="1.4"/>
      <path d="M-5 -14l10 27m1 -29l10 23" fill="none" stroke="#e3b578" stroke-width="1.3"/>
      <ellipse cx="4" cy="14" rx="8.7" ry="7.3" transform="rotate(-26 4 14)" fill="#dfb47a" stroke="#7f5338" stroke-width="1.2"/>
      <ellipse cx="4" cy="14" rx="5.3" ry="4.2" transform="rotate(-26 4 14)" fill="none" stroke="#ac794d" stroke-width="1"/>
      <path d="M3 12q-3 4 2 5m-2 -4l2 -1" fill="none" stroke="#987048" stroke-width=".8"/>
    </g>`).join("")}
    <path d="M-23 -6l37 -8 7 13 -39 8z" fill="#c5b176" fill-opacity=".25" stroke="#d7c48b" stroke-width="2.3"/>
    <path d="M-22 -3l39 -8m-38 15l39 -8" fill="none" stroke="#796b48" stroke-width=".6"/>
  </g>`;
  if(kind==="bronze") return `<g>
    <ellipse cy="19" rx="25" ry="8" fill="#4d574a" opacity=".2"/>
    <path d="M-25 9l8 -13 27 -7 15 13 -7 17 -29 5z" fill="#95653c" stroke="#654a34" stroke-width="1.4"/>
    <path d="M-25 9l27 -6 23 -1 -7 17 -29 5z" fill="url(#${id}-bronze)" stroke="#745135" stroke-width="1.1"/>
    <path d="M-17 -4l27 -7 15 13 -30 8 -20 -1z" fill="#e2be7b" stroke="#f3d49a" stroke-width="1.2"/>
    <path d="M-14 -3l22 -6 10 9 -23 6z" fill="#c19151" opacity=".7"/>
    <path d="M-3 -4l1 6m-4 -1h6m5 -7l2 7m-4 -2h5" stroke="#f5d398" stroke-width="1.1"/>
    <path d="M-21 12l16 5 23 -6m-24 6v5" fill="none" stroke="#ecbd6f" stroke-width="1.1"/>
    <path d="M18 20q8 -3 10 0t-8 5 -4 -4m3 -2q-2 -7 5 -8t2 7" fill="none" stroke="#83603e" stroke-width="3"/>
    <path d="M18 20q8 -3 10 0t-8 5 -4 -4m3 -2q-2 -7 5 -8t2 7" fill="none" stroke="#eac37c" stroke-width="1.7"/>
  </g>`;
  return `<g>
    <ellipse cy="23" rx="18" ry="5.5" fill="#4d574a" opacity=".2"/>
    <path d="M-10 -13q-18 -9 -13 9t12 10m21 -19q18 -9 13 9t-12 10" fill="none" stroke="#854836" stroke-width="5"/>
    <path d="M-10 -14q-15 -7 -11 8t10 9m21 -17q15 -7 11 8t-10 9" fill="none" stroke="#df9567" stroke-width="2.2"/>
    <path d="M-7 -23h14v10q15 6 12 24L12 23q-12 6 -24 0l-7 -12q-3 -18 12 -24z" fill="url(#${id}-wine)" stroke="#764738" stroke-width="1.4"/>
    <path d="M-7 -22h14M-8 -18h16" stroke="#ebbb85" stroke-width="2"/>
    <path d="M-11 -7q-4 8 -1 17" fill="none" stroke="#e8ad7f" stroke-width="2.4" opacity=".85"/>
    <path d="M-17 3q17 8 34 0v9q-17 10 -34 0z" fill="#713c38" stroke="#c18b59" stroke-width="1"/>
    <path d="M-10 7l3 4 4 -3 4 5 5 -4 5 2" fill="none" stroke="#ddb67b" stroke-width="1.4"/>
    <ellipse cy="-23" rx="9" ry="3.4" fill="#e5b786" stroke="#8e563c" stroke-width="1.2"/>
    <ellipse cy="-23" rx="5.6" ry="1.8" fill="#65352e"/>
    <path d="M-9 22q9 4 18 0" stroke="#e4ab75" fill="none" stroke-width="1"/>
  </g>`;
}

function machine(kind,tier,id) {
  const base=`<ellipse cx="1" cy="23" rx="28" ry="8" fill="#304541" opacity=".2"/>
    <path d="M-24 17l11 -6 29 2 10 8 -11 8 -31 -1z" fill="#8b8469" stroke="#635e4b" stroke-width="1.2"/>
    <path d="M-24 17l29 4 21 0 -11 8 -31 -1z" fill="#bdb18c" stroke="#84775d" stroke-width="1"/>
    <path d="M-22 18l26 4 20 -2" fill="none" stroke="#e7d8b2" stroke-width="1.1"/>`;
  let body="";
  if(kind==="ballista")body=`<g class="hw-working">
    <path d="M-17 16l12 -15m20 18l-9 -17M-5 0v22" stroke="#483f31" stroke-width="5.5"/><path d="M-17 16l12 -15m20 18l-9 -17M-5 0v22" stroke="#b68b57" stroke-width="3.4"/>
    <path d="M-18 -4q3 -16 16 -17l13 13q8 8 10 18" fill="none" stroke="#68472f" stroke-width="5.5"/>
    <path d="M-18 -4q3 -16 16 -17l13 13q8 8 10 18" fill="none" stroke="#dcba7a" stroke-width="2.3"/>
    <path d="M-18 -5L4 -4l17 14" stroke="#ede0b2" fill="none" stroke-width="1"/>
    <path d="M-17 10L24 -15" stroke="#4c4030" stroke-width="6"/><path d="M-17 9L24 -16" stroke="#be9357" stroke-width="3"/>
    <path d="M-9 4L26 -18l4 -1 -1 4z" fill="#d9dfc4" stroke="#4c5a50" stroke-width=".9"/>
    <path d="M-13 6l5 1 -2 6 -4 -3" fill="#b65d45" stroke="#724a35" stroke-width=".8"/>
    ${tier>1?'<path d="M-17 16l15 -10m19 11l-10 -12" stroke="#dfbd76" stroke-width="2.1"/>':""}
    ${tier===3?'<path d="M-20 8l7 -4 4 6 -7 4z" fill="#75968c" stroke="#e7c38a"/><path d="M7 -23l3 -5 7 6 -4 6z" fill="#bf8950" stroke="#f1d49e"/>':""}
  </g>`;
  if(kind==="catapult")body=`<g class="hw-working">
    <path d="M-19 18l15 -28 18 31m-18 -31l-1 28" fill="none" stroke="#5b4332" stroke-width="6"/>
    <path d="M-19 18l15 -28 18 31m-18 -31l-1 28" fill="none" stroke="#c0925c" stroke-width="3.4"/>
    <path d="M-12 17L17 -24" stroke="#654631" stroke-width="7"/><path d="M-12 17L17 -24" stroke="#c6a269" stroke-width="4.2"/>
    <path d="M11 -25l11 -3 4 5 -7 6 -8 -3z" fill="#d2c7a1" stroke="#7b745b" stroke-width="1.3"/>
    <path d="M13 -25l7 -1 2 4 -6 2" fill="#eee1bd"/>
    <ellipse cx="-18" cy="20" rx="5" ry="6" fill="url(#${id}-wood)" stroke="#5f4a33" stroke-width="1.5"/>
    <ellipse cx="16" cy="24" rx="5" ry="6" fill="url(#${id}-wood)" stroke="#5f4a33" stroke-width="1.5"/>
    <path d="M-18 16v8m-4 -4h8m30 0v8m-4 -4h8" stroke="#e1ba7c" stroke-width="1.1"/>
    ${tier>1?'<path d="M-9 -7l10 -1 1 6 -9 1z" fill="#b79150" stroke="#f4d69a"/>':""}
    ${tier===3?'<path d="M-22 8l10 -17m23 22l-8 -16" stroke="#dde2c2" stroke-width="2.1"/><path d="M19 13v8" stroke="#ddbb75" stroke-width="3"/>':""}
  </g>`;
  if(kind==="claw")body=`<g class="hw-working">
    <path d="M-12 23V-22L24 -15M-12 -21L5 21M-12 1L13 -16" fill="none" stroke="#5e442f" stroke-width="6"/>
    <path d="M-12 23V-22L24 -15M-12 -21L5 21" fill="none" stroke="#d1a46a" stroke-width="3.5"/>
    <path d="M-12 -19L13 -16" stroke="#e9c78e" stroke-width="1.6"/>
    <rect x="-20" y="-2" width="14" height="12" rx="2" fill="url(#${id}-bronze)" stroke="#775637" stroke-width="1.1"/>
    <circle cx="-13" cy="4" r="3.5" fill="#6e654a" stroke="#f5d591" stroke-width="1"/>
    <g class="hw-hook"><path d="M22 -14V7" fill="none" stroke="#405351" stroke-width="2"/>
    <path d="M21 -13V7" fill="none" stroke="#d1c69d" stroke-width=".7"/>
    <path d="M22 5v8m0 -1l-7 6 -3 -4m10 -2l6 6 3 -4" fill="none" stroke="#435654" stroke-width="3.5"/>
    <path d="M22 5v8m0 -1l-7 6 -3 -4m10 -2l6 6 3 -4" fill="none" stroke="#c8c5a4" stroke-width="1.4"/></g>
    ${tier>1?'<path d="M-18 15l6 -2 3 8 -6 1z" fill="#b89a60" stroke="#ebce93"/>':""}
    ${tier===3?'<path d="M-17 -20h10v5h-10zM-17 12h10v5h-10z" fill="#ddc28a" stroke="#7b6948"/><path d="M-9 -24l22 5" stroke="#dfd1a7" stroke-width="1.4"/>':""}
  </g>`;
  if(kind==="siphon")body=`<g class="hw-working">
    ${(tier===1?[[-7,0]]:tier===2?[[-15,0],[-3,3]]:[[-18,3],[-8,-7],[2,3]]).map(([x,y])=>`<g transform="translate(${x} ${y})">
      <path d="M-6 -15q7 -5 14 0l3 22 -4 10h-12l-4 -9z" fill="url(#${id}-bronze)" stroke="#6d4c33" stroke-width="1.2"/>
      <path d="M-3 -11v20" stroke="#f6d894" stroke-width="1.7"/>
      <path d="M-7 6h17m-17 -14h15" stroke="#77583b" stroke-width="2"/><path d="M-5 5h13" stroke="#e8c582" stroke-width="1.2"/>
      <ellipse cx="1" cy="-16" rx="6" ry="2.2" fill="#c6b07c" stroke="#5f503a"/>
    </g>`).join("")}
    <path d="M0 7L11 -3 23 -10" fill="none" stroke="#704d32" stroke-width="8"/>
    <path d="M0 7L11 -3 23 -10" fill="none" stroke="#c99450" stroke-width="5"/>
    <path d="M3 5L12 -2 23 -8" fill="none" stroke="#f0ce84" stroke-width="1.4"/>
    <path d="M19 -14l8 -2 3 6 -6 6 -5 -2z" fill="#c79754" stroke="#684930" stroke-width="1.2"/>
    <g class="hw-pilot"><path d="M27 -15q7 -5 5 -10q10 6 5 12q-4 7 -10 -2" fill="#db7751"/><path d="M29 -15q5 -4 4 -7q7 6 1 9z" fill="#ffe2a0"/></g>
  </g>`;
  return base+body;
}

function tileArtwork(piece,index,id) {
  if(!piece)return "";
  const faceRight=index%8<2||index%8===4;
  if(!isMachine(piece))return resource(piece.kind,id);
  return `<g class="hw-machine ${piece.kind}" transform="scale(${faceRight?1:-1} 1)">${machine(piece.kind,piece.tier,id)}</g>
    <g class="hw-rank"><circle cx="23" cy="24" r="8.5" fill="#3e514a" stroke="#dbc18b" stroke-width="1.1"/>
    <text x="23" y="27.5" text-anchor="middle">${["","I","II","III"][piece.tier]||piece.tier}</text></g>`;
}

function shipArtwork(ship,id) {
  const kind=String(ship.kind||"skiff"), heavy=ship.mass>=3||ship.boss;
  const sail=ship.boss?"#96594d":/aegis|ward|shield|armor|iron/.test(kind)?"#7c9a97":/raider|swift/.test(kind)?"#b5704e":"#d4c6a1";
  const half=heavy?15:11,len=heavy?31:25,oars=heavy?5:3;
  let blades="";
  for(let i=0;i<oars;i++){
    const y=-len*.38+i*len*.95/(oars-1);
    blades+=`<path d="M${-half+3} ${y}l-8 -6m${2*half+2} 6l8 -6" stroke="#c4a779" stroke-width="1.5"/>`;
  }
  return `<g class="hw-vessel-bob">
    <g class="hw-wake" stroke="#b3d4c3" fill="none" stroke-width="1" opacity=".6"><path d="M-7 ${-len+3}q-2 -8 0 -15m14 15q2 -7 0 -14m-17 13l-5 -8m25 8l5 -7"/></g>
    <g class="hw-oars">${blades}</g>
    <path d="M0 ${len}Q${-half-7} 9 ${-half} ${-len+5}q${half} -7 ${2*half} 0Q${half+7} 9 0 ${len}Z" fill="#3f433b" stroke="#172f35" stroke-width="1.7"/>
    <path d="M0 ${len-4}Q${-half-3} 5 ${-half+3} ${-len+7}q${half-3} -5 ${2*half-6} 0Q${half+3} 5 0 ${len-4}Z" fill="url(#${id}-wood)" stroke="#d3b480" stroke-width="1"/>
    <path d="M0 ${len-10}Q-8 4 -7 ${-len+11}h14Q8 4 0 ${len-10}Z" fill="#6f5840"/>
    <path d="M-8 -12l17 25m-19 -20l18 3" stroke="#e1c18b" stroke-width="1"/>
    <path d="M0 -22v38" stroke="#483e31" stroke-width="3"/>
    <path d="M1 -22v38" stroke="#d8bc85" stroke-width="1"/>
    <path d="M-13 -13q13 -8 27 -3q-5 7 -1 17q-14 -6 -25 0q4 -8 -1 -14Z" fill="${sail}" stroke="#535747" stroke-width="1.1"/>
    <path d="M-11 -12q11 -6 23 -3m-21 3q1 6 0 10" fill="none" stroke="#f0ddaf" stroke-width="1"/>
    ${/raider|swift/.test(kind)?'<path d="M-2 -16q-1 8 0 15" stroke="#eee0bc" stroke-width="3" fill="none"/>':""}
    ${ship.armor>0?[-10,10].map(x=>`<g fill="#c8b17e" stroke="#5c644e" stroke-width="1"><circle cx="${x}" cy="8" r="3"/><circle cx="${x}" cy="15" r="3"/></g>`).join(""):""}
    ${/aegis|ward/.test(kind)?'<path d="M-3 -13h8l-1 8 -4 3 -4 -3z" fill="#406f6c" stroke="#e9d296"/>':""}
    ${ship.boss?'<path d="M1 -23l15 -4 -4 5 3 4 -14 -1z" fill="#dcb677" stroke="#745438" stroke-width="1"/><path d="M-5 -9l4 -3 5 3 -5 4z" fill="#ead095"/>':""}
  </g>`;
}

function indexAt(svg,event) {
  const rect=svg.getBoundingClientRect();
  if(!rect.width||!rect.height)return -1;
  const col=Math.floor(((event.clientX-rect.left)*600/rect.width-GRID_X)/SIZE);
  const row=Math.floor(((event.clientY-rect.top)*500/rect.height-GRID_Y)/SIZE);
  if(col<0||col>=8||row<0||row>=6)return -1;
  return row*8+col;
}

export class HarborBoard {
  constructor(container,handlers={}) {
    this.container=container;this.handlers=handlers;this.id="watch-"+(++nextId);this.destroyed=false;
    this.svg=node("svg",{viewBox:"0 0 600 500",class:"hw-board",role:"group",
      "aria-label":"Harbor board, six rows, eight columns, water in columns three and six"});
    this.svg.innerHTML=gradients(this.id)+`<g aria-hidden="true">${scenery(this.id)}</g>`;
    this.tilesLayer=node("g");this.rangeLayer=node("g",{"aria-hidden":"true",class:"hw-ranges","clip-path":`url(#${this.id}-range-water)`});
    this.fleetLayer=node("g",{"aria-hidden":"true"});this.effectLayer=node("g",{"aria-hidden":"true",class:"hw-effects"});
    this.svg.append(this.rangeLayer,this.tilesLayer,this.fleetLayer,this.effectLayer);
    this.container.replaceChildren(this.svg);
    this.tiles=new Map();this.shipNodes=new Map();this.gesture=null;this.suppressUntil=0;
    this.frame=0;this.battleRef=null;this.forecastRef=null;
    this.reduced=typeof matchMedia==="function"?matchMedia("(prefers-reduced-motion: reduce)"):null;
    for(let index=0;index<48;index++){
      if(!isLand(index))continue;
      const group=node("g",{class:"hw-tile",transform:`translate(${xAt(index%8)} ${yAt(Math.floor(index/8))})`,
        role:"button","data-cell":index,tabindex:index===0?0:-1});
      group.innerHTML='<rect class="hw-hit" x="-33" y="-33" width="66" height="66" fill="transparent"/><rect class="hw-select" x="-31" y="-31" width="62" height="62" rx="7"/><g class="hw-piece" aria-hidden="true"></g><g class="hw-target" aria-hidden="true"><path d="M-28 -16v-12h12m32 0h12v12m0 32v12h-12m-32 0h-12v-12"/></g>';
      this.tiles.set(index,{el:group,piece:group.querySelector(".hw-piece"),key:null});
      this.tilesLayer.append(group);
    }
    this.down=event=>this.pointerDown(event);this.up=event=>this.pointerUp(event);
    this.move=event=>this.pointerMove(event);this.cancel=()=>{this.gesture=null;this.suppressUntil=performance.now()+500;};
    this.click=event=>{
      if(event.detail>0||performance.now()<this.suppressUntil||this.view?.locked)return;
      const target=event.target.closest?.("[data-cell]");
      if(target)this.handlers.onSelect?.(Number(target.dataset.cell));
    };
    this.key=event=>this.keyDown(event);
    this.svg.addEventListener("pointerdown",this.down);
    this.svg.addEventListener("pointerup",this.up);
    this.svg.addEventListener("pointermove",this.move);
    this.svg.addEventListener("pointercancel",this.cancel);
    this.svg.addEventListener("lostpointercapture",this.cancel);
    this.svg.addEventListener("click",this.click);
    this.svg.addEventListener("keydown",this.key);
  }

  pointerDown(event) {
    if(this.gesture){
      if(event.pointerId!==this.gesture.id){
        const pointerId=this.gesture.id;
        this.cancel();
        if(this.svg.hasPointerCapture?.(pointerId))this.svg.releasePointerCapture(pointerId);
      }
      return;
    }
    if(this.view?.locked||event.isPrimary===false||(event.button!==undefined&&event.button!==0))return;
    const index=indexAt(this.svg,event);
    if(!isLand(index))return;
    this.gesture={id:event.pointerId,index,x:event.clientX,y:event.clientY,moved:false};
    this.svg.setPointerCapture?.(event.pointerId);
    for(const [i,tile]of this.tiles)tile.el.setAttribute("tabindex",i===index?"0":"-1");
    this.tiles.get(index)?.el.focus({preventScroll:true});
  }

  pointerMove(event) {
    if(!this.gesture||this.gesture.id!==event.pointerId)return;
    const rect=this.svg.getBoundingClientRect();
    const threshold=Math.max(9,SIZE*rect.width/600*.23);
    if(Math.hypot(event.clientX-this.gesture.x,event.clientY-this.gesture.y)>threshold)this.gesture.moved=true;
  }

  pointerUp(event) {
    const g=this.gesture;
    if(!g||g.id!==event.pointerId)return;
    this.pointerMove(event);
    this.gesture=null;
    if(this.svg.hasPointerCapture?.(event.pointerId))this.svg.releasePointerCapture(event.pointerId);
    this.suppressUntil=performance.now()+500;
    if(this.view?.locked)return;
    let target=indexAt(this.svg,event);
    if(g.moved&&target===g.index){
      const dx=event.clientX-g.x,dy=event.clientY-g.y;
      const step=Math.abs(dx)>Math.abs(dy)?Math.sign(dx):Math.sign(dy)*COLS;
      target=g.index+step;
      if(Math.abs(step)===1&&Math.floor(target/COLS)!==Math.floor(g.index/COLS))target=-1;
    }
    if(!g.moved){this.handlers.onSelect?.(g.index);return;}
    if(isLand(target)&&Math.abs(target%8-g.index%8)+Math.abs(Math.floor(target/8)-Math.floor(g.index/8))===1){
      this.handlers.onSwap?.(g.index,target);
    }
  }

  keyDown(event) {
    const target=event.target.closest?.("[data-cell]");
    if(!target)return;
    const index=Number(target.dataset.cell);
    if(event.key==="Enter"||event.key===" "){
      event.preventDefault();event.stopPropagation();
      if(!event.repeat&&!this.view?.locked)this.handlers.onSelect?.(index);
      return;
    }
    const delta={ArrowLeft:-1,ArrowRight:1,ArrowUp:-8,ArrowDown:8}[event.key];
    let next;
    if(delta){
      next=index+delta;
      while(next>=0&&next<48&&!isLand(next))next+=delta;
      if(Math.abs(delta)===1&&Math.floor(next/8)!==Math.floor(index/8))next=index;
    }else if(event.key==="Home")next=event.ctrlKey?0:Math.floor(index/8)*8;
    else if(event.key==="End")next=event.ctrlKey?47:Math.floor(index/8)*8+7;
    else return;
    event.preventDefault();event.stopPropagation();
    if(this.view?.locked||!isLand(next))return;
    for(const [i,tile]of this.tiles)tile.el.setAttribute("tabindex",i===next?"0":"-1");
    this.tiles.get(next).el.focus({preventScroll:true});
  }

  render(view) {
    if(!view?.state?.board)return;
    this.view=view;
    const {state,selected,locked,forecast,battle}=view;
    const hint=Array.isArray(view.hint)?view.hint:
      view.hint?.from!==undefined?[view.hint.from,view.hint.to]:view.hint?.a!==undefined?[view.hint.a,view.hint.b]:[];
    this.svg.classList.toggle("hw-locked",Boolean(locked));
    this.rangeLayer.replaceChildren();
    const selectedRange=Number.isInteger(selected)?weaponRange(state.board[selected]):null;
    if(selectedRange!==null&&!locked){
      this.rangeLayer.append(node("circle",{cx:xAt(selected%8),cy:yAt(Math.floor(selected/8)),
        r:SIZE*selectedRange,fill:"#f1cf82","fill-opacity":.13,stroke:"#efd195",
        "stroke-width":1.5,"stroke-dasharray":"5 4","stroke-opacity":.8}));
    }
    for(const [index,tile] of this.tiles){
      const piece=state.board[index],key=piece?`${piece.kind}:${piece.tier}`:"empty";
      if(tile.key!==key){
        tile.key=key;tile.piece.innerHTML=tileArtwork(piece,index,this.id);
        tile.piece.classList.remove("hw-changed");
        if(!this.reduced?.matches)requestAnimationFrame(()=>{if(!this.destroyed)tile.piece.classList.add("hw-changed");});
      }
      tile.el.classList.toggle("hw-selected",selected===index);
      tile.el.classList.toggle("hw-hinted",hint.includes(index));
      tile.el.setAttribute("aria-pressed",String(selected===index));
      tile.el.setAttribute("aria-disabled",String(Boolean(locked)));
      const label=piece?`${nameOf(piece.kind)}${piece.tier?`, tier ${piece.tier}`:""}`:"Empty land";
      tile.el.setAttribute("aria-label",`${label}, row ${Math.floor(index/8)+1}, column ${index%8+1}${index===selected&&selectedRange!==null?`, firing range ${Number(selectedRange.toFixed(2))} tiles`:""}`);
    }
    if(battle&&battle!==this.battleRef){this.startBattle(battle);}
    else if(!battle){
      if(this.battleRef){cancelAnimationFrame(this.frame);this.frame=0;this.battleRef=null;this.svg.classList.remove("hw-battle");this.effectLayer.replaceChildren();this.forecastRef=null;
        for(const tile of this.tiles.values())tile.el.classList.remove("hw-firing");}
      if(forecast!==this.forecastRef)this.drawForecast(forecast);
    }
  }

  makeShip(ship) {
    const el=node("g",{class:"hw-ship","data-ship-id":ship.id});
    el.style.setProperty("--oar-phase",(-(shipOrdinal(ship.id)%17)*.47)+"s");
    el.innerHTML=shipArtwork(ship,this.id)+`<g class="hw-health"><rect x="-15" y="30" width="30" height="5" rx="2" fill="#18373b" stroke="#a7aa85" stroke-width=".6"/><rect class="hw-health-fill" x="-14" y="31" width="28" height="3" rx="1" fill="#d6c38a"/></g>`;
    this.fleetLayer.append(el);
    const item={el,health:el.querySelector(".hw-health-fill"),ship};
    this.shipNodes.set(ship.id,item);return item;
  }

  drawForecast(forecast) {
    this.forecastRef=forecast;this.fleetLayer.replaceChildren();this.shipNodes.clear();
    if(!forecast?.enemies)return;
    for(const lane of [2,5]){
      const incoming=forecast.enemies.filter(ship=>ship.lane===lane);
      const preview=incoming.find(ship=>ship.boss)||incoming[0];
      if(!preview)continue;
      const item=this.makeShip(preview);
      item.el.setAttribute("transform",`translate(${xAt(lane)} 16) scale(.58)`);
      item.el.querySelector(".hw-health")?.setAttribute("display","none");
      const count=node("text",{x:xAt(lane)+24,y:22,"text-anchor":"middle",class:"hw-incoming"},`×${incoming.length}`);
      this.fleetLayer.append(count);
    }
  }

  startBattle(battle) {
    cancelAnimationFrame(this.frame);this.battleRef=battle;this.forecastRef=null;
    this.svg.classList.add("hw-battle");this.fleetLayer.replaceChildren();this.effectLayer.replaceChildren();this.shipNodes.clear();
    const events=Array.isArray(battle.events)?battle.events:[],duration=BATTLE_DURATION,total=Math.max(1,battle.ticks||events.at(-1)?.tick+1||1);
    const tracks=new Map();
    for(const ship of battle.enemies||[]){
      tracks.set(ship.id,{ship,moves:[],changes:[],end:null,spawn:Infinity});
      const item=this.makeShip(ship);item.el.setAttribute("opacity","0");
    }
    for(const event of events){
      const track=tracks.get(event.shipId);if(!track)continue;
      if(event.type==="spawn")track.spawn=event.tick;
      if(event.type==="spawn"||event.type==="move")track.moves.push({tick:event.tick,x:event.x??event.to?.x??track.ship.lane,y:event.y??event.to?.y??-.7});
      if(event.hp!==undefined)track.changes.push(event);
      if(["sink","capture","breach"].includes(event.type)){
        track.end=event;
        const at=event.to||event;
        if(Number.isFinite(at.y))track.moves.push({tick:event.tick,x:at.x??track.ship.lane,y:at.y});
      }
    }
    if(this.reduced?.matches){
      for(const {ship}of tracks.values()){
        const item=this.shipNodes.get(ship.id);item.el.setAttribute("opacity",ship.sunk?".25":"1");
        item.el.setAttribute("transform",`translate(${xAt(ship.lane)} ${ship.breached?465:240+(shipOrdinal(ship.id)%4)*42}) scale(.8)`);
        item.health.setAttribute("width",ship.sunk?0:28*Math.max(0,ship.hp)/ship.maxHp);
      }
      return;
    }
    const start=performance.now();
    const tick=now=>{
      if(this.battleRef!==battle)return;
      const progress=Math.min(1,(now-start)/duration),time=progress*total;
      for(const track of tracks.values()){
        const {ship,moves,end}=track,item=this.shipNodes.get(ship.id);
        if(time<track.spawn){item.el.setAttribute("opacity","0");continue;}
        let before=moves[0]||{y:-.7,x:ship.lane,tick:0},after=before;
        for(const move of moves){if(move.tick<=time)before=move;else{after=move;break;}after=before;}
        const mix=after.tick>before.tick?Math.max(0,Math.min(1,(time-before.tick)/(after.tick-before.tick))):0;
        const y=before.y+(after.y-before.y)*mix;
        const ended=end&&time>=end.tick,elapsed=ended?(time-end.tick)/Math.max(total*.13,1):0;
        const alpha=ended?Math.max(0,1-elapsed):1;
        const drift=ship.boss?0:(shipOrdinal(ship.id)%3-1)*5;
        item.el.setAttribute("transform",`translate(${xAt(ship.lane)+drift} ${Math.min(475,yAt(y))}) scale(${ended&&end.type!=="breach"?Math.max(.7,1-elapsed*.17):1})`);
        item.el.setAttribute("opacity",String(alpha));
        let hp=ship.maxHp;for(const change of track.changes){if(change.tick<=time)hp=change.hp;else break;}
        item.health.setAttribute("width",String(28*Math.max(0,Math.min(1,hp/ship.maxHp))));
      }
      this.drawCombatEffects(events,time,total);
      if(progress<1)this.frame=requestAnimationFrame(tick);else this.frame=0;
    };
    this.frame=requestAnimationFrame(tick);
  }

  drawCombatEffects(events,time,total) {
    this.effectLayer.replaceChildren();
    const span=Math.max(1,total*.11);
    const visible=events.filter(e=>["shot","capture","wrench","sink","breach"].includes(e.type)&&e.tick<=time&&time-e.tick<span).slice(-28);
    const activeTowers=new Set(visible.filter(e=>e.from).map(e=>e.from.y*8+e.from.x));
    for(const [index,tile]of this.tiles)tile.el.classList.toggle("hw-firing",activeTowers.has(index));
    for(const e of visible){
      const p=(time-e.tick)/span,to=e.to||{x:e.x,y:e.y};
      if(!Number.isFinite(to.x)||!Number.isFinite(to.y))continue;
      const x=xAt(to.x),y=Math.min(478,yAt(to.y));
      const effect=node("g",{opacity:Math.max(0,1-p)});
      if(e.type==="shot"&&e.from){
        const fx=xAt(e.from.x),fy=yAt(e.from.y),machine=this.view?.state?.board?.[Math.round(e.from.y)*8+Math.round(e.from.x)]?.kind;
        const px=fx+(x-fx)*Math.min(1,p*2.7),py=fy+(y-fy)*Math.min(1,p*2.7)-Math.sin(Math.min(1,p*2.7)*Math.PI)*12;
        if(machine==="siphon"){
          effect.append(node("path",{d:`M${fx} ${fy}Q${(fx+x)/2} ${(fy+y)/2-10} ${x} ${y}`,
            fill:"none",stroke:"#d77949","stroke-width":5,"stroke-linecap":"round",opacity:.75}),
            node("path",{d:`M${fx} ${fy}L${x} ${y}`,stroke:"#ffdfa0","stroke-width":1.5}));
        }else if(machine==="ballista"){
          const a=Math.atan2(y-fy,x-fx);
          effect.append(node("path",{d:`M${px-Math.cos(a)*10} ${py-Math.sin(a)*10}L${px} ${py}`,stroke:"#eee1b4","stroke-width":2}));
        }else effect.append(node("circle",{cx:px,cy:py,r:3.5,fill:"#e0cfaa",stroke:"#7c785f","stroke-width":1}));
        if(p>.3)effect.append(node("circle",{cx:x,cy:y,r:4+p*11,fill:"none",stroke:"#e2d2a0","stroke-width":1.5}));
      }else if(e.type==="capture"||e.type==="wrench"){
        if(e.from)effect.append(node("path",{d:`M${xAt(e.from.x)} ${yAt(e.from.y)-18}Q${x} ${y-30} ${x} ${y}`,fill:"none",stroke:"#d9bb7f","stroke-width":2}));
        effect.append(node("path",{d:`M${x-8} ${y-4}l3 8 5 -4 5 4 3 -8`,fill:"none",stroke:"#eee3bf","stroke-width":2}));
      }else if(e.type==="sink"){
        effect.append(node("ellipse",{cx:x,cy:y,rx:8+p*18,ry:4+p*8,fill:"none",stroke:"#b6d5c4","stroke-width":1.7}));
      }else{
        effect.append(node("circle",{cx:x,cy:472,r:12+p*10,fill:`url(#${this.id}-flare)`}),
          node("path",{d:`M${x-12} 466l7 5 -2 7m19 -12l-7 5 2 7`,fill:"none",stroke:"#e5ad7a","stroke-width":2}));
      }
      this.effectLayer.append(effect);
    }
  }

  destroy() {
    this.destroyed=true;cancelAnimationFrame(this.frame);this.battleRef=null;this.gesture=null;
    for(const [name,handler]of [["pointerdown",this.down],["pointermove",this.move],["pointerup",this.up],
      ["pointercancel",this.cancel],["lostpointercapture",this.cancel],["click",this.click],["keydown",this.key]])this.svg.removeEventListener(name,handler);
    this.svg.remove();this.tiles.clear();this.shipNodes.clear();
  }
}

export function artifactSVG(motif,earned=true) {
  const id="artifact-"+(++nextId);
  const surround=`<path d="M24 78l32 -11 40 10 -31 16z" fill="#554c3b" opacity=".15"/>
    <path d="M29 75l27 -9 35 8 -26 13 -34 -5z" fill="#b8a17b" stroke="#806c50" stroke-width="1"/>
    <path d="M31 77l34 7 24 -9" fill="none" stroke="#e7d5a8" stroke-width="1"/>`;
  let art="";
  if(motif==="tile")art=`<g transform="translate(59 54) scale(.84)">${resource("stone",id)}
    <path d="M-13 -6q6 -8 12 0t12 0M-13 0q6 -8 12 0t12 0" fill="none" stroke="#3d7776" stroke-width="2"/></g>`;
  else if(motif==="caliper")art='<g fill="none" stroke-linejoin="round"><path d="M52 31Q47 54 33 72m19 -41q7 18 23 33l-4 9" stroke="#6c573c" stroke-width="7"/><path d="M52 31Q47 54 33 72m19 -41q7 18 23 33l-4 9" stroke="#d0ac69" stroke-width="4"/><path d="M40 55l25 -3" stroke="#dbbf82" stroke-width="3"/><circle cx="52" cy="31" r="5" fill="#e0c08a" stroke="#7b6646" stroke-width="1.3"/><path d="M32 72l-1 6m41 -5l-1 6" stroke="#74938a" stroke-width="2"/></g>';
  else if(motif==="astrolabe")art=`<g fill="none" stroke="#d8b778"><circle cx="60" cy="51" r="25" fill="url(#${id}-bronze)" stroke="#795e3d" stroke-width="1.7"/><circle cx="60" cy="51" r="21" fill="#536e64" stroke-width="1.1"/><circle cx="60" cy="51" r="16" stroke-width=".9"/><ellipse cx="60" cy="51" rx="16" ry="8" transform="rotate(-25 60 51)" stroke-width=".9"/><path d="M43 65L76 37M60 32v38m-19 -19h38" stroke-width="1.1"/><circle cx="60" cy="51" r="2.5" fill="#f1d094"/><circle cx="60" cy="20" r="4" stroke-width="2"/><path d="M57 25h6" stroke-width="3"/></g>`;
  else if(motif==="crane")art=`<g transform="translate(57 53) scale(.82)">${machine("claw",3,id)}</g>`;
  else art=`<g><path d="M26 32l60 -4 6 46 -61 6z" fill="#bc9c74" stroke="#84694d" stroke-width="1.3"/><path d="M30 36l52 -3 5 37 -53 6z" fill="#3f7775" stroke="#e3c99b"/><path d="M33 61q8 -5 17 -2t17 -1 17 0m-50 9q8 -5 17 -2t17 -1 17 0" fill="none" stroke="#b2c9b0" stroke-width="1.1"/><path d="M39 56V43h5v-5h6v7h8v-5h6v7h8v-5h6v16z" fill="#d4bf95" stroke="#876f4d" stroke-width="1"/><path d="M47 57v-7h5v7m14 0v-7h5v7" fill="#4c7772" stroke="#947d58" stroke-width=".9"/></g>`;
  return `<svg xmlns="${NS}" viewBox="0 0 120 100" role="img" aria-label="${earned?"Collected":"Uncollected"} ${({"harbor-panel":"harbor relief",tile:"wave tile",caliper:"bronze caliper",astrolabe:"astrolabe",crane:"miniature crane"})[motif]||"harbor relief"}">
    ${gradients(id)}<g ${earned?"":'style="filter:grayscale(1);opacity:.28"'}>${surround}${art}</g></svg>`;
}
