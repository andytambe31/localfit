import { chromium } from 'playwright-core'
const today='2026-09-24'
const state={ profile:{ name:'Aniruddha', stepTarget:10000, waterTarget:8, bodyFatTarget:12, bodyFatDeadline:'2026-12-31', height:170, sex:'male',
  phase:{id:2,startedDate:'2026-09-22',goal:'strength-lean'}, gymTargetPerWeek:4, deficit:300, proteinPerKg:{floor:1.9,preferred:2.1,stretch:2.3}, trainStart:'2026-09-22' },
  weightLog:[{date:'2026-09-22',kg:85}], bodyFatLog:[{date:'2026-09-22',pct:22}],
  days:{ [today]:{ foodLoc:'home', food:[{name:'Eggs',meal:'breakfast',protein:24,kcal:210,ts:new Date(today+'T08:00').getTime()}] } }, activity:[], rewardsClaimed:{} }
const b=await chromium.launch({executablePath:process.env.PW_CHROME}); const p=await b.newPage()
await p.addInitScript(([s,t])=>{localStorage.setItem('localfit-state',s);const RD=Date;const f=new RD(t+'T14:00:00');class D extends RD{constructor(...a){if(!a.length)super(f.getTime());else super(...a)} static now(){return f.getTime()}}window.Date=D},[JSON.stringify(state),today])
await p.goto('http://localhost:4391/',{waitUntil:'networkidle'}); await p.waitForTimeout(700)
const mp=await p.evaluate(()=>{const els=[...document.querySelectorAll('div')].filter(d=>/Today's meal plan/.test(d.textContent||''));const el=els.sort((a,b)=>a.textContent.length-b.textContent.length)[0];return el?el.innerText:'(no meal plan)'})
console.log('MEAL PLAN CARD:\n'+mp)
const err=await p.evaluate(()=>window.__err||'none')
console.log('\nno horizontal scroll:', await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth+1))
await b.close()
