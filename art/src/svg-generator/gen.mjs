import {mark,markSmall,C,T,adv,star,withDefs} from './lib.mjs'; import fs from 'fs';
import {fileURLToPath} from 'url'; const OUT=fileURLToPath(new URL('../../../',import.meta.url));
const W=(p,s)=>{fs.mkdirSync(OUT+p.replace(/[^/]+$/,''),{recursive:true});fs.writeFileSync(OUT+p,s)};
const svg=(w,h,body,extra='')=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"${extra}>\n${withDefs(body)}\n</svg>\n`;
const clean=s=>s.replace(/\n\s*/g,'\n');

// 1. marks
W('art/logo-mark.svg', svg(128,128,mark(),' role="img" aria-label="ArghBox"').replace('width="128" height="128"','width="256" height="256"'));
W('art/logo-mark-small.svg', svg(32,32,markSmall(),' role="img" aria-label="ArghBox"').replace('width="32" height="32"','width="128" height="128"'));
// favicon with dark-mode outline
W('art/brand/favicon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
<style>.o{stroke:${C.ink}}@media(prefers-color-scheme:dark){.o{stroke:${C.cream}}}</style>
${markSmall().replace(/stroke="#2b1d1a"/g,'class="o"')}
</svg>
`);
// 2. wordmark
function lockup(dark){
  const o=dark?C.cream:C.ink, size=92, base=91, x=148;
  const a=adv('Argh',size), b=adv('Box',size);
  const w=Math.ceil(x+a+b+10);
  const body=`<g transform="translate(0 0)">${mark({outline:o})}</g>\n`+T('Argh',x,base,size,dark?C.cream:C.ink,{})+T('Box',x+a,base,size,C.accent,{});
  return svg(w-8,128,body,' role="img" aria-label="ArghBox"').replace('viewBox="0 0',`viewBox="8 0`).replace(/viewBox="8 0 (\d+)/,(m,n)=>`viewBox="8 0 ${+n}`);
}
W('art/logo-horizontal.svg', lockup(false)); W('art/logo-horizontal-dark.svg', lockup(true));
// tab icon
W('art/tab-icon.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1 7h14v8H1zM3.5 9.2h9v1.6h-9z"/><path d="M8 0v4M3.5 1.5 5 4M12.5 1.5 11 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" fill="none"/></svg>
`);

// helpers for illustrations
const ST=(w=4)=>`stroke="${C.ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
const rect=(x,y,w,h,r,fill,sw=4)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${ST(sw)}/>`;
function box(x,y,s=1,face=true){ // front-view box ~170x124 at scale 1; origin top-left of lid
  return `<g transform="translate(${x} ${y}) scale(${s})">`+
  rect(14,52,142,74,14,C.accent,6)+rect(0,0,170,52,16,C.accent,6)+
  `<rect x="38" y="16" width="94" height="14" rx="7" fill="${C.ink}"/>`+
  (face?`<circle cx="62" cy="86" r="7" fill="${C.ink}"/><circle cx="108" cy="86" r="7" fill="${C.ink}"/><circle cx="64.4" cy="83.6" r="2.2" fill="#fff"/><circle cx="110.4" cy="83.6" r="2.2" fill="#fff"/><path d="M73 98q12 10 24 0" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round"/>`:'')+`</g>`;
}
function robot(x,y){ // ground at y+190 approx; local coords
  return `<g transform="translate(${x} ${y})">`+
  `<path d="M40 30V10" ${ST(5)} fill="none"/><circle cx="40" cy="6" r="8" fill="${C.yellow}" ${ST(5)}/>`+
  rect(4,30,72,54,18,C.cream,5)+
  `<circle cx="26" cy="56" r="7" fill="${C.ink}"/><circle cx="54" cy="56" r="7" fill="${C.ink}"/><circle cx="28" cy="54" r="2" fill="#fff"/><circle cx="56" cy="54" r="2" fill="#fff"/>`+
  `<path d="M33 70q7 5 14 0" fill="none" ${ST(4)}/>`+
  rect(10,92,60,58,16,C.yellow,5)+`<circle cx="40" cy="120" r="9" fill="${C.accent}" ${ST(4)}/>`+
  rect(16,150,18,22,6,C.ink,4)+rect(46,150,18,22,6,C.ink,4)+`</g>`;
}
function broom(x1,y1,x2,y2){ // handle from top (x1,y1) to head (x2,y2)
  const a=Math.atan2(y2-y1,x2-x1)*180/Math.PI;
  return `<path d="M${x1} ${y1}L${x2} ${y2}" ${ST(6)} fill="none"/>`+
  `<g transform="translate(${x2} ${y2}) rotate(${a-90})"><path d="M-10 0h20l9 34h-38z" fill="${C.yellow}" ${ST(5)}/><path d="M-4 8v20M4 8v20" ${ST(3)} fill="none"/></g>`;
}
function burstLabel(cx,cy,s,label,size){
  const radii=[1,.62,.92,.6,1,.62,.9,.6,.98,.62,.88,.6,1,.62,.92,.6].map(k=>k*s);
  return `<path d="${star(cx,cy,radii,-90)}" fill="${C.yellow}" ${ST(5)}/>`+T(label,cx,cy+size*0.34,size,C.ink,{anchor:'middle'});
}
function bubble(x,y,w,h,label,size,fill=C.card){
  return rect(x,y,w,h,h/2,fill,4)+T(label,x+w/2,y+h/2+size*0.34,size,C.ink,{anchor:'middle'});
}
function scene(){ // 440 x 320
  return `<g transform="translate(0 0)">`+
  `<ellipse cx="215" cy="296" rx="200" ry="10" fill="${C.ink}" opacity=".12"/>`+
  `<path d="M82 86C104 120 118 138 132 160" fill="none" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="2 9"/>`+
  `<path d="M206 66C196 100 180 132 170 160" fill="none" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="2 9"/>`+
  `<path d="M300 74C260 100 224 132 196 160" fill="none" stroke="${C.ink}" stroke-width="3.5" stroke-linecap="round" stroke-dasharray="2 9"/>`+
  box(70,170,1,true).replace('translate(70 170)','translate(60 166)')+
  burstLabel(78,66,60,'ARGH!',23)+
  bubble(150,22,96,44,'bug?',24)+
  `<g transform="rotate(8 330 70)">`+bubble(290,50,86,44,'+1',24,C.cream)+`</g>`+
  broom(334,210,262,264)+
  robot(300,118)+
  `<circle cx="310" cy="222" r="7" fill="${C.cream}" ${ST(4)}/>`+
  `<path d="M236 280l-8 3M240 270l-9-3M250 284l-3 7" ${ST(3.5)} fill="none"/>`+
  `</g>`;
}
// banner
function banner(){
  const size=112,x=262,base=176; const a=adv('Argh',size);
  return svg(1280,400,
  `<rect x="2" y="2" width="1276" height="396" rx="30" fill="${C.paper}" stroke="#ecd6b6" stroke-width="4"/>`+
  `<g transform="translate(70 58) scale(1.5)">${mark()}</g>`+
  T('Argh',x+10,base,size,C.ink,{})+T('Box',x+10+a,base,size,C.accent,{})+
  T('The complaint box',x+12,244,40,C.ink,{f:'body',bold:0.02})+
  T('your AI empties for you.',x+12,292,40,C.ink,{f:'body',bold:0.02})+
  T('Open-source feedback widget for small sites.',x+12,342,22,C.mute,{f:'body'})+
  `<g transform="translate(808 34) scale(1)">${scene()}</g>`,
  ' role="img" aria-label="ArghBox: the complaint box your AI empties for you."');
}
W('art/banner.svg', banner());
export {W,svg,ST,rect,T,C,adv,bubble,robot,burstLabel,box};

// ---- how it works ----
const tri=(x,y,s,fill=C.ink)=>`<path d="M${x} ${y+s*0.85}L${x+s/2} ${y}L${x+s} ${y+s*0.85}z" fill="${fill}" stroke="${fill}" stroke-width="2" stroke-linejoin="round"/>`;
function row(x,y,w,label,votes,{fill=C.card,strike=false,size=19,h=38,op=1}={}){
  let s=`<g opacity="${op}">`+rect(x,y,w,h,11,fill,3.5)+T(label,x+13,y+h/2+size*0.34,size,C.ink,{f:'body'});
  if(strike) s+=`<path d="M${x+9} ${y+h/2+1}H${x+17+adv(label,size,'body')}" stroke="${C.accent}" stroke-width="3.5" stroke-linecap="round"/>`;
  if(votes!==null) s+=rect(x+w-60,y+6,50,h-12,(h-12)/2,C.cream,3)+tri(x+w-50,y+h/2-6,11)+T(String(votes),x+w-24,y+h/2+6,17,C.ink,{anchor:'middle'});
  return s+`</g>`;
}
function pill(x,y,w,h,label,fill,tc,size=16){return rect(x,y,w,h,h/2,fill,3)+T(label,x+w/2,y+h/2+size*0.38,size,tc,{anchor:'middle'});}
function robotHead(x,y,s){return `<g transform="translate(${x} ${y}) scale(${s})"><path d="M40 30V10" ${ST(5)} fill="none"/><circle cx="40" cy="6" r="8" fill="${C.yellow}" ${ST(5)}/>`+rect(4,30,72,54,18,C.cream,5)+`<circle cx="26" cy="56" r="7" fill="${C.ink}"/><circle cx="54" cy="56" r="7" fill="${C.ink}"/><circle cx="28" cy="54" r="2" fill="#fff"/><circle cx="56" cy="54" r="2" fill="#fff"/><path d="M33 70q7 5 14 0" fill="none" ${ST(4)}/></g>`;}
function card(x,n,title,sub,inner){
  return rect(x,40,340,360,26,C.card,4)+
  `<circle cx="${x+46}" cy="88" r="23" fill="${C.accent}" ${ST(4)}/>`+T(String(n),x+46,88+10,29,'#fff',{anchor:'middle'})+
  T(title,x+82,99,29,C.ink)+T(sub,x+26,142,18,C.mute,{f:'body'})+inner;
}
function how(){
  const A=(x)=>`<path d="M${x+8} 220H${x+38}M${x+26} 204l16 16-16 16" fill="none" stroke="${C.accent}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
  // card 1
  let x=40;
  const c1=card(x,1,'Visitors say argh','They vote and drop new ideas.',
    rect(x+26,166,288,208,18,C.soft,4)+
    row(x+40,180,260,'Dark mode please',24)+row(x+40,226,260,'Search is slow',9)+
    rect(x+40,282,260,40,11,'#fff',3.5)+T('Argh? Tell us.',x+53,282+20+6.5,19,C.mute,{f:'body'})+
    pill(x+214,330,86,30,'Send',C.accent,'#fff',17));
  x=430;
  const c2=card(x,2,'Your AI triages','Spam out, duplicates merged.',
    row(x+26,168,212,'buy cheap w4tches',null,{strike:true,op:.9})+pill(x+246,172,68,30,'spam',C.accent,'#fff',16)+
    row(x+26,218,212,'dark mode?',null,{fill:C.yellow})+row(x+26,264,212,'dark theme pls',null,{fill:C.yellow})+
    `<path d="M${x+248} 232q12 0 12 14t12 14M${x+248} 280q12 0 12-14" fill="none" ${ST(4)}/>`+
    pill(x+272,238,48,30,'x2',C.cream,C.ink,17)+
    row(x+26,316,212,'search is slow',null,{})+`<path d="M${x+247} 336l7 7 14-16" fill="none" stroke="${C.ink}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`+robotHead(x+278,316,.52));
  x=820;
  const c3=card(x,3,'A clean list','For visitors and for you.',
    row(x+26,166,288,'Dark mode please',31,{fill:C.yellow})+row(x+26,212,288,'Search is slow',9)+row(x+26,258,288,'Typo on pricing page',4)+
    pill(x+26,318,70,32,'New',C.cream,C.ink,16)+pill(x+104,318,96,32,'Planned',C.accent,'#fff',16)+pill(x+208,318,76,32,'Done',C.cream,C.ink,16));
  return svg(1200,440,
    `<rect x="2" y="2" width="1196" height="436" rx="30" fill="${C.paper}" stroke="#ecd6b6" stroke-width="4"/>`+c1+A(384)+c2+A(774)+c3+
    robotHead(x+0,0,0),' role="img" aria-label="How ArghBox works: visitors drop arghs and vote, your own AI triages them, and you get a clean list."').replace(/<g transform="translate\(820 0\) scale\(0\)">.*?<\/g>/,'');
}
W('art/how-it-works.svg', how());
