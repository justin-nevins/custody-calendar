// Custody Calendar schedule engine. No DOM. Used by the page (window.CCEngine) and by the
// PocketBase hooks on the server (require('./engine.js')), so both compute the same calendar.
// Time is "floating": every instant is a UTC millisecond stamp that stands for local wall time.
(function(root,factory){
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.CCEngine=api;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
const HOUR=3600000, DAYMS=86400000;
const utc=(y,m,d,h=0)=>Date.UTC(y,m-1,d,h);
const addD=(t,n)=>t+n*DAYMS;
const ymd=t=>new Date(t).toISOString().slice(0,10);
const hm=t=>new Date(t).toISOString().slice(11,16);
const DOWN=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const dow=t=>new Date(t).getUTCDay();
// Dates are typed and shown as MM-DD-YYYY (MM/DD/YYYY also read); YYYY-MM-DD is the stored form and is read too.
const mkDate=(y,mo,d)=>{ if(mo<1||mo>12||d<1||d>31)return null; const t=utc(y,mo,d); return new Date(t).getUTCDate()===d?t:null; };
const parseDate=s=>{s=(s||'').trim(); let m=/^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s); if(m)return mkDate(+m[1],+m[2],+m[3]); m=/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/.exec(s); return m?mkDate(+m[3],+m[1],+m[2]):null};
const usd=t=>{const d=new Date(t);return `${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}-${d.getUTCFullYear()}`};
const usdStr=s=>{const t=parseDate(s);return t===null?(s||''):usd(t)};
const parseHours=s=>{s=(s||'').trim(); if(s==='24:00'||s==='end')return 24; const m=/^(\d{1,2})(?::(\d{2}))?$/.exec(s); return m?Math.min(24,+m[1]):0};
const nth=(y,m,n,wd)=>{let t=utc(y,m,1);const off=(wd-dow(t)+7)%7;return addD(t,off+7*(n-1))};
const last=(y,m,wd)=>{let t=utc(y,m+1,0);const off=(dow(t)-wd+7)%7;return addD(t,-off)};
const monBefore=(y,m,d)=>{let t=utc(y,m,d);const off=(dow(t)+6)%7;return addD(t,-(off===0?7:off))};
const monOnOrBefore=t=>addD(t,-((dow(t)+6)%7));
const easter=y=>{const a=y%19,b=Math.floor(y/100),c=y%100,d=Math.floor(b/4),e=b%4,f=Math.floor((b+8)/25),g=Math.floor((b-f+1)/3),h=(19*a+b-d-g+15)%30,i=Math.floor(c/4),k=c%4,l=(32+2*e+2*i-h-k)%7,m=Math.floor((a+11*h+22*l)/451),mo=Math.floor((h+l-7*m+114)/31),da=((h+l-7*m+114)%31)+1;return utc(y,mo,da)};
const fixed=(m,d)=>{ const f=y=>utc(y,m,d); f.md=[m,d]; return f; };
// Month-day text ("MM-DD") to [m,d], or null.
const parseMd=s=>{ const m=/^\s*(\d{1,2})[-\/](\d{1,2})\s*$/.exec(s||''); if(!m)return null; const mo=+m[1],d=+m[2]; return (mo>=1&&mo<=12&&d>=1&&d<=31&&mkDate(2028,mo,d)!==null)?[mo,d]:null; };
const mdText=t=>{const d=new Date(t);return `${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`};
// A year in which the anchor date exists: y itself, or the next leap year when the anchor is February 29.
const mdYear=(md,y)=>{ for(let k=0;k<8;k++){ if(mkDate(y+k,md[0],md[1])!==null)return y+k; } return y; };
// First and last day of a fixed-date period in year y, from its days before and after: {s,e} day stamps.
function fixedSpan(md,cfg,y){ const Y=mdYear(md,y); const a=utc(Y,md[0],md[1]); return {s:addD(a,-(+cfg.before||0)),e:addD(a,(+cfg.after||0))}; }
// Days before (which='start') or after (which='end') the anchor for a typed month-day, counted in year y;
// a date on the other side of the year boundary counts forward into the next year (December 28 to January 2 = 5).
// null when the text is not a month-day.
function daysFromMd(md,text,which,y){ const v=parseMd(text); if(!v)return null; const Y=mdYear(md,y); const a=utc(Y,md[0],md[1]); const t=mkDate(Y,v[0],v[1])!==null?utc(Y,v[0],v[1]):utc(mdYear(v,Y),v[0],v[1]); let n=Math.round((which==='start'?a-t:t-a)/DAYMS); if(n<0){ const yl=Math.round((utc(Y+1,1,1)-utc(Y,1,1))/DAYMS); n+=yl; } return n; }

// Holiday catalog. pri: 1 birthdays / Mother's Day / Father's Day, 2 Thanksgiving and Christmas, 3 vacation periods, 4 other days. 0 = one-time changes (strongest).
const CAT=[
 {id:'newyear',name:"New Year's Day",region:'Both',ruleText:'January 1',rule:fixed(1,1),pri:4},
 {id:'mlk',name:'Martin Luther King Jr. Day',region:'US',ruleText:'3rd Monday of January',rule:y=>nth(y,1,3,1),pri:4},
 {id:'family',name:'Family Day',region:'Canada',ruleText:'3rd Monday of February',rule:y=>nth(y,2,3,1),pri:4},
 {id:'presidents',name:"Presidents' Day",region:'US',ruleText:'3rd Monday of February',rule:y=>nth(y,2,3,1),pri:4},
 {id:'valentine',name:"Valentine's Day",region:'Both',ruleText:'February 14',rule:fixed(2,14),pri:4},
 {id:'stpatrick',name:"St. Patrick's Day",region:'Both',ruleText:'March 17',rule:fixed(3,17),pri:4},
 {id:'goodfriday',name:'Good Friday',region:'Canada',ruleText:'Friday before Easter',rule:y=>addD(easter(y),-2),pri:4},
 {id:'easter',name:'Easter Sunday',region:'Both',ruleText:'Easter Sunday',rule:y=>easter(y),pri:4},
 {id:'eastermon',name:'Easter Monday',region:'Canada',ruleText:'Monday after Easter',rule:y=>addD(easter(y),1),pri:4},
 {id:'mothers',name:"Mother's Day",region:'Both',ruleText:'2nd Sunday of May',rule:y=>nth(y,5,2,0),pri:1},
 {id:'victoria',name:'Victoria Day',region:'Canada',ruleText:'Monday before May 25',rule:y=>monBefore(y,5,25),pri:4},
 {id:'memorial',name:'Memorial Day',region:'US',ruleText:'Last Monday of May',rule:y=>last(y,5,1),pri:4},
 {id:'fathers',name:"Father's Day",region:'Both',ruleText:'3rd Sunday of June',rule:y=>nth(y,6,3,0),pri:1},
 {id:'juneteenth',name:'Juneteenth',region:'US',ruleText:'June 19',rule:fixed(6,19),pri:4},
 {id:'canadaday',name:'Canada Day',region:'Canada',ruleText:'July 1',rule:fixed(7,1),pri:4},
 {id:'july4',name:'Independence Day',region:'US',ruleText:'July 4',rule:fixed(7,4),pri:4},
 {id:'civic',name:'Civic Holiday',region:'Canada',ruleText:'1st Monday of August',rule:y=>nth(y,8,1,1),pri:4},
 {id:'labor',name:'Labor Day / Labour Day',region:'Both',ruleText:'1st Monday of September',rule:y=>nth(y,9,1,1),pri:4},
 {id:'truth',name:'National Day for Truth and Reconciliation',region:'Canada',ruleText:'September 30',rule:fixed(9,30),pri:4},
 {id:'columbus',name:"Columbus Day / Indigenous Peoples' Day",region:'US',ruleText:'2nd Monday of October',rule:y=>nth(y,10,2,1),pri:4},
 {id:'thanksca',name:'Thanksgiving (Canada)',region:'Canada',ruleText:'2nd Monday of October',rule:y=>nth(y,10,2,1),pri:2},
 {id:'halloween',name:'Halloween',region:'Both',ruleText:'October 31',rule:fixed(10,31),pri:4},
 {id:'veterans',name:'Veterans Day',region:'US',ruleText:'November 11',rule:fixed(11,11),pri:4},
 {id:'remembrance',name:'Remembrance Day',region:'Canada',ruleText:'November 11',rule:fixed(11,11),pri:4},
 {id:'thanksus',name:'Thanksgiving (US)',region:'US',ruleText:'4th Thursday of November',rule:y=>nth(y,11,4,4),pri:2},
 {id:'blackfriday',name:'Day after Thanksgiving',region:'US',ruleText:'Friday after Thanksgiving',rule:y=>addD(nth(y,11,4,4),1),pri:4},
 {id:'prexmas',name:'Pre-Christmas period',region:'Both',ruleText:'December 18 to 23',rule:fixed(12,18),pri:2,plan:{who:'motherOdd',before:0,after:5,start:'10:00',end:'10:00'}},
 {id:'xmasper',name:'Christmas period',region:'Both',ruleText:'December 23 to 28',rule:fixed(12,23),pri:2,plan:{who:'motherEven',before:0,after:5,start:'10:00',end:'10:00'}},
 {id:'xmaseve',name:'Christmas Eve',region:'Both',ruleText:'December 24',rule:fixed(12,24),pri:2},
 {id:'xmas',name:'Christmas Day',region:'Both',ruleText:'December 25',rule:fixed(12,25),pri:2},
 {id:'boxing',name:'Boxing Day',region:'Canada',ruleText:'December 26',rule:fixed(12,26),pri:4},
 {id:'nyper',name:'New Year period',region:'Both',ruleText:'December 28 to January 2',rule:fixed(12,28),pri:2,plan:{who:'motherOdd',before:0,after:5,start:'10:00',end:'10:00'}},
 {id:'nye',name:"New Year's Eve",region:'Both',ruleText:'December 31',rule:fixed(12,31),pri:4},
 {id:'febtime',name:"{mother}'s February time",region:'Plan',ruleText:'February 1 to 14',rule:fixed(2,1),pri:3,sameCity:true,plan:{who:'mother',before:0,after:13,start:'00:00',end:'24:00'}},
 {id:'maytime',name:"{mother}'s May time",region:'Plan',ruleText:'May 1 to 14',rule:fixed(5,1),pri:3,sameCity:true,plan:{who:'mother',before:0,after:13,start:'00:00',end:'24:00'}},
];
const PLANSET={mothers:{who:'mother',before:2,after:1,start:'17:00',end:'10:00'},fathers:{who:'father',before:2,after:1,start:'17:00',end:'10:00'},thanksus:{who:'motherOdd',before:3,after:4,start:'10:00',end:'10:00'}};
const WEEKLY_PLAN=[{week:1,parent:'father',sd:4,st:'17:00',ed:1,et:'09:00'},{week:2,parent:'father',sd:4,st:'12:00',ed:5,et:'17:00'}];
// Parents are two slots, M and F (the keys never change so saved settings stay valid). Each slot has a role:
// mother, father or parent. Plan defaults are written in role words (mother, father, motherOdd, motherEven) and
// resolved to a slot through the roles, so naming Parent 1 "Justin" and marking him the father moves every
// default with him. Saved choices a user made by hand are slot codes (M, F, Modd, Meven) and stay as chosen.
const ROLE_TOKENS=['mother','father','motherOdd','motherEven'];
function roles(S){ const p=(S&&S.parents)||{}; const rM=(p.M&&p.M.role)||'mother', rF=(p.F&&p.F.role)||'father'; return {mother:rM==='mother'?'M':rF==='mother'?'F':null, father:rF==='father'?'F':rM==='father'?'M':null}; }
function resolveWho(who,S){ if(!ROLE_TOKENS.includes(who))return who; const r=roles(S); const mom=r.mother||(r.father==='M'?'F':'M'); const dad=r.father||(mom==='M'?'F':'M'); if(who==='mother')return mom; if(who==='father')return dad; if(who==='motherOdd')return mom==='M'?'Modd':'Meven'; return mom==='M'?'Meven':'Modd'; }
function slotName(S,k){ const p=S&&S.parents&&S.parents[k]; if(p&&p.name)return p.name; const role=(p&&p.role)||(k==='M'?'mother':'father'); return role==='mother'?'Mother':role==='father'?'Father':(k==='M'?'Parent 1':'Parent 2'); }
function entryName(entry,S){ return String(entry.name||'').replace(/\{mother\}/g,()=>{const r=roles(S);return r.mother?slotName(S,r.mother):'Mother';}).replace(/\{father\}/g,()=>{const r=roles(S);return r.father?slotName(S,r.father):'Father';}); }
function whoFor(who,y){ if(who==='M'||who==='F')return who; if(who==='Modd')return (y%2===1)?'M':'F'; return (y%2===0)?'M':'F'; }
function parsePeriods(text){
  const out=[];
  for(const part of (text||'').split(/[;\n]/)){
    const m=/^\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4})(?:\s+(\d{1,2}:\d{2}))?\s*(?:to|–|-)\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[-\/]\d{1,2}[-\/]\d{4})(?:\s+(\d{1,2}:\d{2}))?\s*$/.exec(part);
    if(!m)continue;
    const a=parseDate(m[1]),b=parseDate(m[3]); if(a===null||b===null)continue;
    const s=a+parseHours(m[2]||'0:00')*HOUR, e=b+parseHours(m[4]||'24:00')*HOUR;
    if(e>s)out.push([s,e]);
  }
  return out;
}
function periodsFor(entry,cfg,y,day){
  const who=whoFor(cfg.who,y); const list=[];
  const ov=parsePeriods(cfg.dates).filter(([s])=>new Date(s).getUTCFullYear()===y);
  const applies=cfg.applies||(entry.sameCity?'local':'both');
  if(ov.length){ for(const [s,e] of ov) list.push({s,e,who,name:entry.name,pri:entry.pri,applies}); return list; }
  if(day===null)return list;
  const s=addD(day,-(+cfg.before||0))+parseHours(cfg.start)*HOUR;
  let e=addD(day,(+cfg.after||0))+parseHours(cfg.end)*HOUR;
  if(e<=s)e+=DAYMS;
  list.push({s,e,who,name:entry.name,pri:entry.pri,applies});
  return list;
}
function computeSchedule(c){
  const start=parseDate(c.start); if(start===null)throw new Error('The calendar start date is missing (Settings, Limits and range).');
  const y0=new Date(start).getUTCFullYear(), years=Math.max(1,Math.min(10,+c.years||1));
  const t0=start, t1=utc(y0+years,1,1); const N=Math.round((t1-t0)/HOUR);
  const par=new Uint8Array(N); const src=new Int16Array(N);
  const P={M:1,F:2}, R={1:'M',2:'F'};
  const xh=parseHours(c.xtime);
  let begins=c.begins||'start', ldStart=null, noMove=false;
  if(begins==='move'){ const m=parseDate(c.move); if(m===null){ begins='never'; noMove=true; } else ldStart=addD(m,-(+c.movePre||0))+xh*HOUR; }
  else if(begins==='date'){ const d=parseDate(c.ldDate); if(d===null)throw new Error('Enter the date the long distance schedule starts (Settings, Which schedule is in force).'); ldStart=d+xh*HOUR; }
  else if(begins==='start'){ ldStart=t0+xh*HOUR; }
  const weeklyPhase = begins==='never' || (c.weeklyOn!==false && begins!=='start' && ldStart!==null);
  const blocksAnchor = ldStart!==null?ldStart:(t0+xh*HOUR);
  const pattern=(c.pattern||[]).map(Number).filter(n=>n>0); if(begins!=='never'&&!pattern.length)throw new Error('The block pattern needs at least one number (Settings, Long Distance Schedule).');
  const cycleLen=pattern.reduce((a,b)=>a+b,0)||1;
  let order=pattern.length?pattern.map((n,k)=>({p:k%2===0?1:2,n})):[{p:1,n:1}];
  if(c.first==='F'){ const k=order.findIndex(o=>o.p===2); if(k>0)order=order.slice(k).concat(order.slice(0,k)); }
  const blockParent=(t)=>{ let off=Math.floor((t-blocksAnchor)/DAYMS); off=((off%cycleLen)+cycleLen)%cycleLen; let acc=0; for(const o of order){ acc+=o.n; if(off<acc)return o.p; } return order[order.length-1].p; };
  const wpc=Math.max(1,Math.min(4,+c.weeksPerCycle||2));
  const wa=parseDate(c.weekAnchor); const anchorMon=monOnOrBefore(wa!==null?wa:t0);
  const rows=(c.weekly||[]).map(r=>({...r,week:+r.week||1,sd:+r.sd,ed:+r.ed,sh:parseHours(r.st),eh:parseHours(r.et)}));
  const weeklyParent=(t)=>{
    const cyc=Math.floor((t-anchorMon)/(7*DAYMS*wpc)); const cycStart=anchorMon+cyc*7*DAYMS*wpc;
    for(const r of rows){
      const wk=cycStart+(r.week-1)*7*DAYMS;
      const s=wk+((r.sd+6)%7)*DAYMS+r.sh*HOUR; let e=wk+((r.ed+6)%7)*DAYMS+r.eh*HOUR; if(e<=s)e+=7*DAYMS;
      for(const base of [s-7*DAYMS*wpc,s,s+7*DAYMS*wpc]){ if(t>=base&&t<base+(e-s))return P[r.parent]||2; }
    }
    return rows.length&&rows[0].parent==='F'?1:(rows.length?2:1);
  };
  const le=parseDate(c.ldEnd); const ldEnd=(le!==null&&begins!=='never'&&c.weeklyOn!==false)?le+xh*HOUR:null;
  const inWeekly=(t)=> begins==='never' || (weeklyPhase && t<ldStart) || (ldEnd!==null && t>=ldEnd);
  const periods=[];
  for(let y=y0-1;y<=y0+years;y++){
    for(const h of CAT){ const cfg=c.holidays&&c.holidays[h.id]; if(!cfg||!cfg.on)continue; const entry=(c.names&&c.names[h.id])?{...h,name:c.names[h.id]}:h; for(const p of periodsFor(entry,cfg,y,h.rule(y)))periods.push(p); }
    for(const [id,cfg] of Object.entries(c.birthdays||{})){ if(!cfg||!cfg.on)continue; const m=/^(\d{1,2})-(\d{1,2})$/.exec((cfg.md||'').trim()); const day=m?utc(y,+m[1],+m[2]):null; for(const p of periodsFor({name:cfg.name||'Birthday',pri:1},cfg,y,day))periods.push(p); }
    // Recurring vacation time: a period a parent has every year (the plan's first two weeks of February and May).
    // A recurring vacation is `days` full 24-hour periods from its start time: 14 days from Feb 1 12:00 ends Feb 15 12:00.
    for(const rv of (c.recurring||[])){ if(!rv||rv.on===false)continue; const m=/^(\d{1,2})-(\d{1,2})$/.exec((rv.md||'').trim()); const day=m?utc(y,+m[1],+m[2]):null; if(day===null)continue; const s=day+parseHours(rv.start||'00:00')*HOUR, e=s+Math.max(1,+rv.days||1)*DAYMS; periods.push({s,e,who:whoFor(rv.who,y),name:rv.name||'Vacation',pri:3,applies:rv.applies||'both',kind:'vacation'}); }
  }
  for(const cu of (c.customs||[])){ for(const [ps,pe] of parsePeriods(cu.dates)){ const y=new Date(ps).getUTCFullYear(); periods.push({s:ps,e:pe,who:whoFor(cu.who||'M',y),name:cu.name||'Custom period',pri:(cu.pri==null||cu.pri==='')?3:+cu.pri,applies:cu.applies||'both',kind:cu.kind||'custom'}); } }
  periods.sort((a,b)=>b.pri-a.pri);
  periods.forEach((p,k)=>{p.idx=k+1;});
  // Fit vacation times to the schedule (c.fit): on a vacation's first day and last day, it starts and ends at that day's
  // regular exchange time (5:00 p.m. when the day's exchange is at 5, 10:00 a.m. when it is at 10). Entered times apply
  // only on days without a regular exchange. Vacations and recurring vacation time only.
  if(c.fit!==false){
    const regAt=i=>{ const t=t0+i*HOUR; return inWeekly(t)?weeklyParent(t):blockParent(t); };
    const dayBounds=(d)=>{ const out=[]; const a=Math.max(1,d*24), b=Math.min(N,(d+1)*24); for(let i=a;i<b;i++){ if(regAt(i)!==regAt(i-1))out.push(i); } return out; };
    for(const p of periods){
      if(p.kind!=='vacation')continue;
      const ds=Math.floor((p.s-t0)/DAYMS), de=Math.floor((p.e-HOUR-t0)/DAYMS);
      if(ds>=0&&ds*24<N){ const bs=dayBounds(ds); if(bs.length){ const hs=Math.round((p.s-t0)/HOUR); const k=bs.reduce((best,i)=>Math.abs(i-hs)<Math.abs(best-hs)?i:best,bs[0]); p.s=t0+k*HOUR; } }
      if(de>=0&&de*24<N){ const be=dayBounds(de); if(be.length){ const he=Math.round((p.e-t0)/HOUR); const k=be.reduce((best,i)=>Math.abs(i-he)<Math.abs(best-he)?i:best,be[0]); const ne=t0+k*HOUR; if(ne>p.s)p.e=ne; } }
    }
  }
  // Period overlay: which hours a holiday, birthday, vacation, custom period or one-time change takes, and for whom.
  const pp=new Uint8Array(N), ps=new Int16Array(N);
  for(const p of periods){
    const i0=Math.max(0,Math.ceil((p.s-t0)/HOUR)), i1=Math.min(N,Math.ceil((p.e-t0)/HOUR));
    for(let i=i0;i<i1;i++){ const loc=inWeekly(t0+i*HOUR); if(p.applies==='local'&&!loc)continue; if(p.applies==='ld'&&loc)continue; pp[i]=P[p.who]; ps[i]=p.idx; }
  }
  // Make-up rules for regular hours a holiday or birthday takes from the parent whose block it falls in.
  // c.makeup==='shift': the block clock pauses while the period takes time, so the whole cycle shifts later. When that
  //   period ends, the pause is rounded to whole days, so exchanges keep their usual time.
  // c.makeup==='fixed': the cycle dates stay where they are. The lost hours, rounded to whole days when the period
  //   ends, are owed to that parent and are paid at the first regular hours of the other parent that follow, so the
  //   parent's block is extended and the other parent's next block starts later. Days lost by both parents offset each
  //   other before anything is paid. Make-up hours carry src -2.
  // Vacations count only when c.makeupVac is set. Custom periods and one-time changes never count. The local schedule is never changed.
  const makeup=c.makeup==='shift', fixed=c.makeup==='fixed'; let shiftH=0, shiftTotal=0, segStart=0, curSeg=0; const countsForMakeup=p=>!p.kind||(p.kind==='vacation'&&!!c.makeupVac);
  const owed=[0,0,0]; let segOwed=[0,0,0]; let madeH=0, owedTotal=0;
  const closeSeg=()=>{
    if(makeup){ const lostH=shiftH-segStart; const snapped=Math.round(lostH/24)*24; shiftH=segStart+snapped; shiftTotal+=snapped/24; }
    if(fixed){ for(const p of [1,2]){ const snapped=Math.round(segOwed[p]/24)*24; owed[p]+=snapped; owedTotal+=snapped; } const n=Math.min(owed[1],owed[2]); owed[1]-=n; owed[2]-=n; owedTotal-=2*n; segOwed=[0,0,0]; }
  };
  for(let i=0;i<N;i++){
    const t=t0+i*HOUR; const loc=inWeekly(t);
    if((makeup||fixed)&&ps[i]!==curSeg){ // a period segment ends: snap what it took to whole days
      if(curSeg>0)closeSeg();
      curSeg=ps[i]; segStart=shiftH;
    }
    const regular=loc?weeklyParent(t):blockParent(makeup?t-shiftH*HOUR:t);
    if(ps[i]>0){
      par[i]=pp[i]; src[i]=ps[i];
      if(!loc&&countsForMakeup(periods[ps[i]-1])&&pp[i]!==regular){ if(makeup)shiftH++; if(fixed)segOwed[regular]++; }
    } else if(fixed&&!loc&&owed[3-regular]>0){ par[i]=3-regular; src[i]=-2; owed[3-regular]--; madeH++; }
    else { par[i]=regular; }
  }
  if((makeup||fixed)&&curSeg>0)closeSeg();
  // Bridge short gaps (c.bridge): when the regular schedule would hand the child back to the vacationing parent within
  // 24 hours of a vacation's end (or hand the child away for under 24 hours just before its start), the vacation runs
  // through that gap with no exchange. Vacations and recurring vacation time only; holidays keep their exact edges.
  if(c.bridge!==false){
    for(const p of periods){
      if(p.kind!=='vacation')continue; const who=P[p.who];
      const e=Math.min(N,Math.ceil((p.e-t0)/HOUR)), s=Math.max(0,Math.ceil((p.s-t0)/HOUR));
      if(e<N&&e>0&&src[e-1]===p.idx&&par[e]!==who){ for(let k=e+1;k<Math.min(N,e+24);k++){ if(src[k]!==0)break; if(par[k]===who){ for(let i=e;i<k;i++){par[i]=who;src[i]=p.idx;} break; } } }
      if(s>0&&s<N&&src[s]===p.idx&&par[s-1]!==who){ for(let k=s-2;k>=Math.max(0,s-24);k--){ if(src[k]!==0)break; if(par[k]===who){ for(let i=k+1;i<s;i++){par[i]=who;src[i]=p.idx;} break; } } }
    }
  }
  // Exchange time rules (c.xrules, each {applies, days, dates, time}): a regular exchange that matches a rule moves to
  // the rule's time on the same day. The parent whose time was ending keeps the hours up to a later time; the parent
  // whose time is starting takes the hours back from an earlier time. Holiday, make-up and limit boundaries are not moved.
  const xrules=(c.xrules||[]).map(r=>({...r,h:parseHours(r.time),ranges:parsePeriods(r.dates||'')})).filter(r=>r.time); const movedByRule=new Set();
  if(xrules.length){
    const bounds=[]; for(let i=1;i<N;i++){ if(par[i]!==par[i-1]&&src[i]===0&&src[i-1]===0)bounds.push(i); }
    for(const i of bounds){
      const t=t0+i*HOUR; const loc=inWeekly(t);
      const rule=xrules.find(r=>ruleMatches(r,t,loc)); if(!rule)continue;
      const h=new Date(t).getUTCHours(); const j=i-h+rule.h; if(j===i||j<0||j>=N)continue;
      if(j>i){ const p=par[i-1]; let k=i; for(;k<j;k++){ if(src[k]!==0)break; par[k]=p; } movedByRule.add(k); }
      else { const p=par[i]; let k=i-1; for(;k>=j;k--){ if(src[k]!==0)break; par[k]=p; } movedByRule.add(k+1); }
    }
  }
  const limitH=(+c.limit||21)*24; let movedH=0;
  if(c.mode==='cap'){
    let i=0;
    while(i<N){
      const p=par[i]; const s=i; while(i<N&&par[i]===p)i++;
      const e=i;
      if(inWeekly(t0+s*HOUR))continue; // the local schedule is not under the rule
      let ex=e-s-limitH; if(ex<=0)continue;
      ex=Math.ceil(ex/24)*24; const other=3-p;
      const isHol=k=>src[k]>0||src[k]===-2; // periods and make-up days are not taken by the limit rule
      const take=k=>{par[k]=other;src[k]=-1;ex--;movedH++};
      let j=e-1; while(ex>0&&j>=s&&!isHol(j)){take(j);j--}
      j=s; while(ex>0&&j<e&&!isHol(j)){take(j);j++}
      j=e-1; while(ex>0&&j>=s){ if(!isHol(j)&&par[j]===p)take(j); j--; }
    }
  }
  const segs=[]; { let i=0; while(i<N){const p=par[i],s=i; while(i<N&&par[i]===p)i++; segs.push({p:R[p],s:t0+s*HOUR,e:t0+i*HOUR,h:i-s});} }
  const reason=(i)=>{ const k=src[i]; if(k===-1)return 'day limit rule'; if(k===-2)return 'make-up days'; if(k>0)return periods[k-1].name; return 'regular schedule'; };
  const exchanges=[];
  for(let k=1;k<segs.length;k++){ const sg=segs[k]; const i=Math.round((sg.s-t0)/HOUR); const prev=segs[k-1];
    const pi=src[i]>0?periods[src[i]-1]:null, pp=src[i-1]>0?periods[src[i-1]-1]:null;
    let why, kind='regular';
    if(pp&&pp.pri===0){why=pp.name+' ends';kind='change';} else if(pi&&pi.pri===0){why=pi.name+' begins';kind='change';}
    else if(pi){why=pi.name+' begins';kind='period';} else if(src[i]===-1){why='day limit rule';kind='limit';} else if(src[i]===-2){why='make-up days begin';kind='makeup';} else if(pp){why=pp.name+' ends';kind='period';} else if(src[i-1]===-1){why='day limit rule';kind='limit';} else if(src[i-1]===-2){why='make-up days end';kind='makeup';} else why=(inWeekly(sg.s)?'local schedule':'long distance schedule')+(movedByRule.has(i)?', time set by an exchange rule':'');
    exchanges.push({t:sg.s,from:prev.p,to:sg.p,why,kind}); }
  const summary=[];
  for(let y=y0;y<y0+years;y++){
    const a=Math.max(t0,utc(y,1,1)), b=utc(y+1,1,1); const ia=Math.round((a-t0)/HOUR), ib=Math.round((b-t0)/HOUR);
    let mh=0,fh=0,moved=0,made=0; for(let i=ia;i<ib;i++){ if(par[i]===1)mh++; else fh++; if(src[i]===-1)moved++; if(src[i]===-2)made++; }
    const ex=exchanges.filter(x=>x.t>=a&&x.t<b).length;
    const runs=segs.filter(sg=>sg.e>a&&sg.s<b);
    const lm=Math.max(0,...runs.filter(r=>r.p==='M').map(r=>r.h)), lf=Math.max(0,...runs.filter(r=>r.p==='F').map(r=>r.h));
    const over=segs.filter(sg=>sg.h>limitH&&sg.s>=a&&sg.s<b);
    summary.push({y,mDays:mh/24,fDays:fh/24,ex,lm:lm/24,lf:lf/24,over,moved:moved/24,made:made/24});
  }
  const over=segs.filter(sg=>sg.h>limitH);
  const days={};
  for(let t=utc(y0,1,1);t<t1;t=addD(t,1)){
    const i0=Math.round((t-t0)/HOUR); let m=0,f=0,hol=false,cap=false,mk=false,first=null,firstH=0,second=null; const cnt={};
    for(let k=0;k<24;k++){ const i=i0+k; if(i<0||i>=N)continue; const p=R[par[i]]; if(first===null){first=p} if(p===first&&second===null)firstH++; else if(second===null)second=p; if(p==='M')m++; else f++; if(src[i]>0){hol=true;cnt[src[i]]=(cnt[src[i]]||0)+1;} if(src[i]===-1)cap=true; if(src[i]===-2)mk=true; }
    if(first===null)continue;
    let pname=null,ppri=null,pwho=null,chg=null; let best=0; for(const [k,v] of Object.entries(cnt)){ const p=periods[+k-1]; if(p.pri===0)chg=p.name; if(v>best&&p.pri>0){best=v; pname=p.name; ppri=p.pri; pwho=p.who;} }
    if(!pname&&chg){pname=chg;ppri=0;}
    const bad=over.some(sg=>sg.s<t+DAYMS&&sg.e>t);
    const ex=exchanges.some(x=>x.t>=t&&x.t<t+DAYMS);
    days[ymd(t)]={first,second,firstH,m,f,hol,cap,mk,bad,ex,pname,ppri,pwho,chg};
  }
  return {t0,t1,y0,years,segs,exchanges,summary,over,days,periods,limitH,movedH,shiftDays:shiftTotal,madeDays:madeH/24,owedDays:(owed[1]+owed[2])/24,ldStart:(weeklyPhase&&begins!=='never')?ldStart:null,ldEnd,weeklyPhase,begins,noMove,inLocal:inWeekly};
}

// ===================== State to engine config =====================
// S is the saved settings object (v5). names: parent names come from S.parents. withChanges: include one-time changes
// (they need the base calendar, so the caller passes the result computed without them as `base`).
const parentName=(S,k)=>slotName(S,k);
// Exchange rules: S.xrules = [{applies:'both'|'ld'|'local', days:{0..6:true}, dates:'period list', placeKind:'none'|
// 'ending'|'starting'|'text', place:'', time:'HH:MM' or ''}]. The first matching rule with a place sets the place; the
// first matching rule with a time sets the time (the engine moves the exchange). A rule with no days and no dates
// matches every exchange under the schedule it applies to.
function ruleMatches(r,t,loc){
  if(r.applies==='ld'&&loc)return false; if(r.applies==='local'&&!loc)return false;
  const days=r.days||{}; const anyDay=Object.values(days).some(Boolean); if(anyDay&&!days[dow(t)])return false;
  const ranges=r.ranges||parsePeriods(r.dates||''); if(ranges.length&&!ranges.some(([a,b])=>t>=a&&t<b))return false;
  return true;
}
// The place of an exchange x in result r under settings S, as text ('' when none).
function exchangePlace(S,r,x){
  const loc=r&&r.inLocal?r.inLocal(x.t):false; const PN=k=>slotName(S,k);
  for(const rule of (S.xrules||[])){
    if(!rule.placeKind||rule.placeKind==='none')continue; if(!ruleMatches(rule,x.t,loc))continue;
    if(rule.placeKind==='ending')return `${PN(x.from)}'s home`; if(rule.placeKind==='starting')return `${PN(x.to)}'s home`;
    if(rule.placeKind==='text'&&(rule.place||'').trim())return rule.place.trim();
  }
  if(x.kind!=='regular')return '';
  return ((loc?S.phase.weekly.place:S.regular.place)||'').trim();
}
function configFrom(S,withChanges,base){
  const birthdays={}; const PN=k=>parentName(S,k);
  (S.children||[]).forEach((c,i)=>{ birthdays['child'+i]={on:!!c.on&&!!(c.md||'').trim(),name:(c.name?c.name+"'s":"Child's")+' birthday',md:c.md,who:c.who,before:c.before,after:c.after,start:c.start,end:c.end,applies:c.applies||'both'}; });
  for(const k of ['M','F']){ const b=(S.pbd||{})[k]||{}; birthdays['p'+k]={on:!!b.on&&!!(b.md||'').trim(),name:PN(k)+"'s birthday",md:b.md,who:k,before:b.before,after:b.after,start:b.start,end:b.end,applies:b.applies||'both'}; }
  const customs=(S.customs||[]).map(c=>({...c,kind:'custom'}));
  for(const v of ((S.vacations||{}).list||[])){ if(!v.s||!v.e)continue; customs.push({name:v.note?`${PN(v.who)}'s vacation: ${v.note}`:`${PN(v.who)}'s vacation`,who:v.who,dates:`${v.s} ${v.sh||'10:00'} to ${v.e} ${v.eh||'10:00'}`,pri:3,kind:'vacation',applies:v.applies||'both'}); }
  if(withChanges) for(const ch of (S.changes||[])){ for(const p of changePeriods(ch,base)) customs.push({name:ch.note||(ch.kind==='swap'?'Swap':'One-time change'),who:p.who,dates:`${ymd(p.s)} ${hm(p.s)} to ${ymd(p.e)} ${hm(p.e)}`,pri:0,kind:'change',applies:ch.applies||'both'}); }
  const holidays={}, names={}; for(const [id,h] of Object.entries(S.holidays||{})) if(h&&h.on){ holidays[id]={...h,on:true,who:resolveWho(h.who,S)}; const cat=CAT.find(x=>x.id===id); if(cat)names[id]=entryName(cat,S); }
  for(const b of Object.values(birthdays))b.who=resolveWho(b.who,S);
  for(const cu of customs)cu.who=resolveWho(cu.who,S);
  const begins=S.regular.on?S.phase.begins:'never';
  return {start:S.cal.start,years:S.cal.years,limit:S.cal.limit,mode:S.cal.mode,makeup:S.cal.makeup||'none',makeupVac:!!S.cal.makeupVac,
    pattern:String(S.regular.pattern||'').split(/[,\s/-]+/).filter(Boolean),first:resolveWho(S.regular.first,S),xtime:S.regular.xtime||'12:00',
    begins,move:S.phase.move||null,movePre:+S.phase.movePre||0,ldDate:S.phase.ldDate||null,ldEnd:S.phase.ldEnd||null,weeklyOn:!!S.phase.weeklyOn,weekly:(S.phase.weekly.rows||[]).map(r=>({...r,parent:resolveWho(r.parent,S)})),weeksPerCycle:+S.phase.weeksPerCycle||2,weekAnchor:S.phase.weekAnchor,
    holidays,birthdays,customs,names,
    recurring:(((S.vacations||{}).recurring)||[]).map(r=>({...r,who:resolveWho(r.who,S)})),bridge:(S.vacations||{}).bridge!==false,fit:(S.vacations||{}).fit!==false,
    xrules:(S.xrules||[]).filter(r=>r&&r.time).map(r=>({applies:r.applies||'both',days:r.days||{},dates:r.dates||'',time:r.time}))};
}
// A one-time change becomes a short period with priority 0. 'move': an exchange at old date/time happens at a new
// date/time instead. 'give': a period goes to one parent. `base` is the schedule computed without changes.
// shift: whole days added to every date of the change (used for weekly repeats).
function changePeriod(ch,base,shift){
  const sh=(shift||0)*DAYMS;
  if(ch.kind==='give'){ const s=parseDate(ch.s), e=parseDate(ch.e); if(s===null||e===null)return null; const S=s+sh+parseHours(ch.sh)*HOUR, E=e+sh+parseHours(ch.eh)*HOUR; return E>S?{s:S,e:E,who:ch.who}:null; }
  if(ch.kind==='swap')return null; // two legs: see changePeriods
  const od=parseDate(ch.date), nd=parseDate(ch.newDate||ch.date); if(od===null||nd===null)return null;
  const o=od+sh+parseHours(ch.time)*HOUR, n=nd+sh+parseHours(ch.newTime)*HOUR; if(o===n)return null;
  const x=base&&base.exchanges.find(x=>x.t===o); if(!x)return null;
  return n>o?{s:o,e:n,who:x.from}:{s:n,e:o,who:x.to};
}
// A swap has two legs: leg a goes to one parent, leg b to the other. Each leg is a give.
const swapLeg=(ch,k)=>{ const L=(ch&&ch[k])||{}; return {kind:'give',who:L.who,s:L.s,sh:L.sh,e:L.e,eh:L.eh}; };
// Every period a change produces: one for a give or move, two for a swap, and every weekly repeat up to
// ch.repeatUntil (a date; occurrences whose first date is after it are not produced). A repeated move whose base
// exchange does not exist on a later week is skipped for that week.
function changePeriods(ch,base){
  const out=[]; const until=parseDate(ch.repeatUntil||''); const first=parseDate(ch.kind==='move'?ch.date:ch.kind==='swap'?(ch.a&&ch.a.s):ch.s);
  const weeks=(until!==null&&first!==null&&until>=first)?Math.min(104,Math.floor((until-first)/(7*DAYMS))):0;
  for(let w=0;w<=weeks;w++){ const shift=w*7;
    if(ch.kind==='swap'){ for(const k of ['a','b']){ const p=changePeriod(swapLeg(ch,k),base,shift); if(p)out.push({...p,leg:k}); } }
    else { const p=changePeriod(ch,base,shift); if(p)out.push(p); }
  }
  return out;
}
// Hours each parent gains from a change (positive) over one occurrence, ignoring what the base calendar already
// gave them; used for the swap balance line. Returns {M,F}.
function changeHours(ch){
  const h={M:0,F:0}; const legs=ch.kind==='swap'?[swapLeg(ch,'a'),swapLeg(ch,'b')]:ch.kind==='give'?[ch]:[];
  for(const L of legs){ const s=parseDate(L.s), e=parseDate(L.e); if(s===null||e===null||!L.who)continue; const n=((e+parseHours(L.eh)*HOUR)-(s+parseHours(L.sh)*HOUR))/HOUR; if(n>0)h[L.who]=(h[L.who]||0)+n; }
  return h;
}
function hoursText(n){ return n>=24&&n%24===0?`${n/24} day${n===24?'':'s'}`:n>=24?`${fmt1(n/24)} days`:`${fmt1(n)} hour${n===1?'':'s'}`; }
// One-line text of a change, with MM-DD-YYYY dates; shared by the page, the account layer and the OFW text.
function changeSummary(S,ch){
  const PN=k=>slotName(S,k); const d=(x,t)=>`${usdStr(x)} ${t||''}`.trim();
  let s;
  if(ch.kind==='give')s=`${PN(ch.who)} has ${d(ch.s,ch.sh)} to ${d(ch.e,ch.eh)}`;
  else if(ch.kind==='swap'){ const a=ch.a||{}, b=ch.b||{}; const h=changeHours(ch); const diff=(h.M||0)-(h.F||0);
    s=`${PN(a.who)} has ${d(a.s,a.sh)} to ${d(a.e,a.eh)}; in return ${PN(b.who)} has ${d(b.s,b.sh)} to ${d(b.e,b.eh)} (${diff===0?'even trade':`${PN(diff>0?'M':'F')} gains ${hoursText(Math.abs(diff))}`})`; }
  else s=`exchange of ${d(ch.date,ch.time)} happens ${d(ch.newDate||ch.date,ch.newTime)} instead`;
  if(ch.repeatUntil)s+=`; repeats weekly until ${usdStr(ch.repeatUntil)}`;
  return s;
}
// Text to paste into OFW for a change request or an answer (the plan requires requests between the parents through
// OFW). opts: {from, to: slot keys or names, answer:'approve'|'decline'|'counter'|'withdraw', note, answerBy}.
function ofwText(S,ch,opts={}){
  const PN=k=>(k==='M'||k==='F')?slotName(S,k):(k||'');
  const L=[];
  const what=opts.what||changeSummary(S,ch); const kindName=opts.kindName||(ch.kind==='swap'?'Swap of parenting time':ch.kind==='move'?'Moved exchange':ch.kind==='give'?'Parenting time given':'Schedule change'); const section=opts.section||'Section II.F, Schedule Changes';
  if(opts.answer){
    const verb=opts.answer==='approve'?'agrees to':opts.answer==='decline'?'does not agree to':opts.answer==='counter'?'proposes instead of':'withdraws';
    L.push(`Re: ${kindName} (Parenting Plan, ${section})`,'',`${PN(opts.from)||'I'} ${verb} the request: ${what}.`);
    if(opts.answer==='counter'&&opts.counter)L.push(`Proposed instead: ${changeSummary(S,opts.counter)}.`);
  } else {
    if(opts.care)L.push(`Notice: ${kindName} (Parenting Plan, ${section})`,'',`${PN(opts.from)||'I'} will be away from the child for more than eight hours during ${PN(opts.from)?'their':'my'} parenting time: ${what}. ${PN(opts.to)||'The other parent'} has the first option to care for the child during that time.`);
    else { L.push(`Request: ${kindName} (Parenting Plan, ${section})`,'',`${PN(opts.from)||'I'} ask${PN(opts.from)?'s':''} ${PN(opts.to)||'the other parent'} to agree to this one-time change: ${what}.`); L.push('The regular schedule is not changed. Holiday, vacation and special-day periods stay as they are.'); }
    if(opts.answerBy)L.push(`An answer by ${usdStr(opts.answerBy)} would help with planning.`);
  }
  if(opts.note||ch.note)L.push(`Reason: ${opts.note||ch.note}.`);
  if(!opts.answer)L.push('Please answer through OFW. Thank you.');
  return L.join('\n');
}
// Both calendars from one settings object: base (no one-time changes) and result (with them).
function build(S){ const base=computeSchedule(configFrom(S,false,null)); const result=computeSchedule(configFrom(S,true,base)); return {base,result}; }

// ===================== Proposals =====================
// Apply one proposal to a settings object and return the new settings (the input is not changed). One-time changes
// and vacations are edited item by item; everything else travels as "the settings" and keeps the current items.
// Throws an Error with a plain sentence when the proposal is malformed or the calendar cannot be built from it.
function applyProposal(settings,kind,payload){
  let s=JSON.parse(JSON.stringify(settings));
  if(kind==='settings'){
    if(!payload||typeof payload.settings!=='object')throw new Error('The proposal has no settings.');
    const next=JSON.parse(JSON.stringify(payload.settings));
    next.changes=s.changes||[]; next.vacations=next.vacations||{}; next.vacations.list=(s.vacations&&s.vacations.list)||[];
    s=next;
  } else if(kind==='change'||kind==='vacation'||kind==='care'){ // a care request is a give to the other parent
    const item=payload&&payload.item; if(!item||!item.id)throw new Error('The proposal has no item.');
    const list=kind!=='vacation'?(s.changes=s.changes||[]):((s.vacations=s.vacations||{}).list=s.vacations.list||[]);
    const i=list.findIndex(x=>x.id===item.id); if(i>=0)list[i]=item; else list.push(item);
  } else if(kind==='remove'){
    const list=payload&&payload.list, id=payload&&payload.id;
    if(!id||(list!=='changes'&&list!=='vacations'))throw new Error('The proposal does not say what to remove.');
    const arr=list==='changes'?(s.changes||[]):((s.vacations&&s.vacations.list)||[]);
    const i=arr.findIndex(x=>x.id===id); if(i<0)throw new Error('That item is no longer on the calendar.');
    arr.splice(i,1);
  } else throw new Error('Unknown proposal kind.');
  try{ build(s); }catch(err){ throw new Error('The calendar cannot be built with this change: '+(err&&err.message?err.message:err)); }
  return s;
}
// What differs between two settings objects, by section, plus the items added, edited or removed.
const SECTION_KEYS={people:s=>[s.parents,s.children,s.pbd],regular:s=>[s.regular],local:s=>[s.phase.weeklyOn,s.phase.weekAnchor,s.phase.weeksPerCycle,s.phase.weekly],change:s=>[s.phase.begins,s.phase.move,s.phase.movePre,s.phase.ldDate,s.phase.ldEnd],hol:s=>[s.holidays,s.customs],vac:s=>[s.vacations&&s.vacations.allow,s.vacations&&s.vacations.notice,s.vacations&&s.vacations.maxLen,s.vacations&&s.vacations.recurring,s.vacations&&s.vacations.bridge,s.vacations&&s.vacations.fit],limits:s=>[s.cal],xch:s=>[s.xrules||[]]};
// JSON with sorted keys, so the same settings compare equal whichever side built the object.
function stable(x){ if(x===undefined)return 'null'; if(x===null||typeof x!=='object')return JSON.stringify(x); if(Array.isArray(x))return '['+x.map(stable).join(',')+']'; return '{'+Object.keys(x).sort().map(k=>x[k]===undefined?null:JSON.stringify(k)+':'+stable(x[k])).filter(Boolean).join(',')+'}'; }
function diffSettings(a,b){
  const J=stable;
  const sections=Object.keys(SECTION_KEYS).filter(k=>J(SECTION_KEYS[k](a))!==J(SECTION_KEYS[k](b)));
  const items=(la,lb,list)=>{ const out=[]; const A=new Map((la||[]).map(x=>[x.id,x])), B=new Map((lb||[]).map(x=>[x.id,x])); for(const [id,x] of B){ if(!A.has(id))out.push({op:'add',list,item:x}); else if(J(A.get(id))!==J(x))out.push({op:'edit',list,item:x}); } for(const [id,x] of A){ if(!B.has(id))out.push({op:'remove',list,item:x}); } return out; };
  return {sections,items:[...items(a.changes,b.changes,'changes'),...items(a.vacations&&a.vacations.list,b.vacations&&b.vacations.list,'vacations')]};
}

// ===================== Exports =====================
const icsDate=t=>new Date(t).toISOString().replace(/[-:]/g,'').slice(0,15);
const icsEsc=s=>String(s==null?'':s).replace(/\\/g,'\\\\').replace(/;/g,'\\;').replace(/,/g,'\\,').replace(/\r?\n/g,'\\n');
const fmt1=n=>String(Math.round(n*10)/10);
// The page's parent colors as calendar colors: a CSS color name for the per-event COLOR property (RFC 7986) and the
// hex used for the calendar-level color some apps read on subscription.
const CAL_COLORS={blue:{css:'steelblue',hex:'#2f6db5'},orange:{css:'chocolate',hex:'#d9772a'},green:{css:'seagreen',hex:'#2e8b57'},purple:{css:'rebeccapurple',hex:'#7a3fa5'},teal:{css:'teal',hex:'#1f8a8a'},pink:{css:'mediumvioletred',hex:'#c2457a'}};
function parentColor(S,k){ const c=S&&S.parents&&S.parents[k]&&S.parents[k].color; return CAL_COLORS[c]||CAL_COLORS[k==='M'?'blue':'orange']; }
// names: {M,F}. opts.name: calendar name shown by the subscribing app. opts.stamp: fixed DTSTAMP (tests).
// opts.S: settings (exchange places, parent colors). opts.who: 'M' or 'F' gives only that parent's blocks, plus every
// exchange (both parents are at each one), so each parent's time can be its own calendar with its own color and the
// exchange times still show when only one calendar is loaded.
// "Sheigh with Justin" when the settings name the child (several names joined with "and"); "With Justin" otherwise.
function childLabel(S){ const names=((S&&S.children)||[]).map(c=>(c&&c.name||'').trim()).filter(Boolean); if(!names.length)return ''; return names.length===1?names[0]:names.slice(0,-1).join(', ')+' and '+names[names.length-1]; }
function icsText(r,names,opts={}){
  const PN=k=>names[k]||k; const child=childLabel(opts.S); const withT=k=>child?`${child} with ${PN(k)}`:`With ${PN(k)}`; const stamp=icsDate(opts.stamp||Date.now())+'Z'; const who=opts.who==='M'||opts.who==='F'?opts.who:null;
  const L=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//custody-calendar.com//planner//EN','CALSCALE:GREGORIAN'];
  // Calendar names as they appear in the subscribing app: "Justin Custody" for a parent's calendar, "Sheigh Custody"
  // (or the given name) for the full one.
  const name=opts.name?(who?`${PN(who)} Custody`:(child?`${child} Custody`:opts.name)):'';
  if(name)L.push('X-WR-CALNAME:'+icsEsc(name),'NAME:'+icsEsc(name));
  if(who&&opts.S){ const c=parentColor(opts.S,who); L.push('X-APPLE-CALENDAR-COLOR:'+c.hex.toUpperCase(),'COLOR:'+c.css); }
  if(opts.refresh)L.push('REFRESH-INTERVAL;VALUE=DURATION:'+opts.refresh,'X-PUBLISHED-TTL:'+opts.refresh);
  const col=k=>opts.S?parentColor(opts.S,k).css:'';
  const ev=(uid,s,e,sum,desc,loc,color)=>{L.push('BEGIN:VEVENT',`UID:${uid}@custody-calendar.com`,`DTSTAMP:${stamp}`,`DTSTART:${icsDate(s)}`,`DTEND:${icsDate(e)}`,`SUMMARY:${icsEsc(sum)}`);if(desc)L.push(`DESCRIPTION:${icsEsc(desc)}`);if(loc)L.push(`LOCATION:${icsEsc(loc)}`);if(color)L.push(`COLOR:${color}`);L.push('END:VEVENT');};
  r.segs.forEach((sg,i)=>{ if(who&&sg.p!==who)return; ev('blk'+i+'-'+icsDate(sg.s),sg.s,sg.e,withT(sg.p),`${fmt1(sg.h/24)} days`,'',col(sg.p)); });
  r.exchanges.forEach((x,i)=>{ ev('ex'+i+'-'+icsDate(x.t),x.t,x.t+30*60000,`Exchange: ${PN(x.from)} to ${PN(x.to)}`,x.why,opts.S?exchangePlace(opts.S,r,x):'',col(x.to)); });
  L.push('END:VCALENDAR'); return L.join('\r\n');
}
// Days whose owner differs between two results (used to mark a proposal on the calendar).
function diffDays(a,b){ const out=[]; const keys=new Set([...Object.keys(a.days),...Object.keys(b.days)]); for(const k of keys){ const x=a.days[k],y=b.days[k]; if(!x||!y){out.push(k);continue;} if(x.first!==y.first||x.second!==y.second||x.firstH!==y.firstH)out.push(k); } return out.sort(); }
// Exchanges in b that are not in a, and in a not in b.
function diffExchanges(a,b){ const key=x=>`${x.t}|${x.from}|${x.to}`; const A=new Set(a.exchanges.map(key)), B=new Set(b.exchanges.map(key)); return {added:b.exchanges.filter(x=>!A.has(key(x))),removed:a.exchanges.filter(x=>!B.has(key(x)))}; }

return {HOUR,DAYMS,utc,addD,ymd,hm,usd,usdStr,DOWN,dow,parseDate,parseHours,nth,last,monBefore,monOnOrBefore,easter,fixed,parseMd,mdText,fixedSpan,daysFromMd,CAT,PLANSET,WEEKLY_PLAN,ROLE_TOKENS,roles,resolveWho,slotName,entryName,whoFor,parsePeriods,periodsFor,computeSchedule,configFrom,changePeriod,changePeriods,changeHours,changeSummary,ofwText,build,ruleMatches,exchangePlace,parentColor,CAL_COLORS,applyProposal,diffSettings,stable,icsText,diffDays,diffExchanges};
});
