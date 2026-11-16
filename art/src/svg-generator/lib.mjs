import opentype from 'opentype.js';
const r = n => +n.toFixed(1);
import fs0 from 'fs';
const ld=n=>{const buf=fs0.readFileSync(new URL('../../fonts/'+n,import.meta.url));return opentype.parse(buf.buffer.slice(buf.byteOffset,buf.byteOffset+buf.byteLength));};
export const fonts={display:ld('LilitaOne-Regular.ttf'),body:ld('VarelaRound-Regular.ttf')};
export const C = {accent:'#e8553d', ink:'#2b1d1a', paper:'#fff6e9', yellow:'#ffc83d', dark:'#1f1613', cream:'#fff6e9', card:'#ffffff', soft:'#ffe7c7', mute:'#7a6a63'};
function gp(g,x,y,size){const p=g.getPath(0,0,size);return p.commands.map(c=>{const o=[c.type];if('x1' in c)o.push(r(c.x1+x),r(c.y1+y));if('x2' in c)o.push(r(c.x2+x),r(c.y2+y));if('x' in c)o.push(r(c.x+x),r(c.y+y));return o[0]+o.slice(1).join(' ')}).join('')}
function layout(str,size,f){const ft=fonts[f],sc=size/ft.unitsPerEm;let x=0,prev=null;const out=[];for(const ch of str){const g=ft.charToGlyph(ch);if(prev){try{const k=ft.getKerningValue(prev,g)*sc;if(Number.isFinite(k))x+=k}catch(e){}}out.push([g,x]);x+=g.advanceWidth*sc;prev=g;}return {out,w:x};}
export function adv(str, size, f='display'){ return layout(str,size,f).w; }
// text as outlined path; bold = stroke thickness as fraction of size
const glyphDefs=new Map();
function gdef(f,ch,g){const id=`${f[0]}${ch.codePointAt(0).toString(16)}`;if(!glyphDefs.has(id)){const upm=fonts[f].unitsPerEm;glyphDefs.set(id,gp(g,0,0,upm).replace(/(\d)(?=[A-Z])/g,'$1'));}return id;}
export function withDefs(body){const ids=[...new Set([...body.matchAll(/href="#([a-z][0-9a-f]+)"/g)].map(m=>m[1]))];if(!ids.length)return body;return `<defs>${ids.map(i=>`<path id="${i}" d="${glyphDefs.get(i)}"/>`).join('')}</defs>
`+body;}
export function T(str, x, y, size, fill, {anchor='start', bold=0, extra='', f='display'}={}){
  const {out,w}=layout(str,size,f);
  const x0 = anchor==='middle'? x-w/2 : anchor==='end'? x-w : x;
  const k=size/fonts[f].unitsPerEm, sw=bold?` stroke="${fill}" stroke-width="${r(size*bold/k)}" stroke-linejoin="round"`:'';
  const uses=out.filter(([g])=>g.advanceWidth!==undefined&&g.index!==fonts[f].charToGlyph(' ').index).map(([g,dx],i)=>{const ch=[...str][out.indexOf(out.find(o=>o[0]===g&&o[1]===dx))];const id=gdef(f,ch,g);return `<use href="#${id}" transform="translate(${r(x0+dx)} ${r(y)}) scale(${+k.toFixed(5)})"/>`}).join('');
  return `<g fill="${fill}"${sw}${extra}>${uses}</g>`;
}
export function star(cx,cy,radii,rot=-90){
  const n=radii.length; const pts=radii.map((rad,i)=>{const a=(rot+i*360/n)*Math.PI/180;return `${r(cx+rad*Math.cos(a))} ${r(cy+rad*Math.sin(a))}`});
  return 'M'+pts.join('L')+'Z';
}
export const burstRadii=[26,18,26,17,30,18,27,17,28,18,25,17,29,18]; // 7 spikes
export function mark({outline=C.ink, face=true, bang=true}={}){
  const o=outline;
  return `<path d="${star(64,32,burstRadii,-86)}" fill="${C.yellow}" stroke="${o}" stroke-width="6" stroke-linejoin="round"/>`+
  (bang?`<path d="M60 15h8l-1.5 19h-5z" fill="${C.ink}" stroke="${C.ink}" stroke-width="3" stroke-linejoin="round"/><circle cx="64" cy="42" r="4" fill="${C.ink}"/>`:'')+
  `<rect x="22" y="76" width="84" height="42" rx="9" fill="${C.accent}" stroke="${o}" stroke-width="6" stroke-linejoin="round"/>`+
  `<rect x="14" y="60" width="100" height="22" rx="9" fill="${C.accent}" stroke="${o}" stroke-width="6" stroke-linejoin="round"/>`+
  `<rect x="40" y="67" width="48" height="8" rx="4" fill="${C.ink}"/>`+
  (face?`<circle cx="46" cy="98" r="5.2" fill="${C.ink}"/><circle cx="82" cy="98" r="5.2" fill="${C.ink}"/><circle cx="47.7" cy="96.3" r="1.6" fill="#fff"/><circle cx="83.7" cy="96.3" r="1.6" fill="#fff"/><path d="M56 106q8 7 16 0" fill="none" stroke="${C.ink}" stroke-width="4.2" stroke-linecap="round"/>`:'');
}
export function markSmall(outline=C.ink,bang=false){
  return `<path d="${star(16,9.5,[8.6,5,7.6,4.8,8.8,5,7.8,4.8,8.4,5,7.4,4.8,8.6,5],-86)}" fill="${C.yellow}" stroke="${outline}" stroke-width="2" stroke-linejoin="round"/>`+
  (bang?`<path d="M14.6 4.6h2.8l-.5 5.4h-1.8z" fill="${C.ink}" stroke="${C.ink}" stroke-width="1" stroke-linejoin="round"/><circle cx="16" cy="12.6" r="1.3" fill="${C.ink}"/>`:'')+
  `<rect x="5" y="20" width="22" height="9.5" rx="2.5" fill="${C.accent}" stroke="${outline}" stroke-width="2" stroke-linejoin="round"/>`+
  `<rect x="3" y="13.5" width="26" height="8" rx="3" fill="${C.accent}" stroke="${outline}" stroke-width="2" stroke-linejoin="round"/>`+
  `<rect x="8.5" y="16" width="15" height="3" rx="1.5" fill="${C.ink}"/>`;
}
