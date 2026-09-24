import { chromium } from 'playwright-core'
const today = '2026-09-24'
const state = {
  profile: { name:'Aniruddha', stepTarget:10000, waterTarget:8, bodyFatTarget:12, bodyFatDeadline:'2026-12-31', gymTargetPerWeek:3, trainStart:'2026-08-01' },
  days: {}, weightLog:[{date:'2026-09-20', kg:85}], bodyFatLog:[{date:'2026-09-20', pct:22}], activity:[], rewardsClaimed:{},
}
const EXE = process.env.PW_CHROME
const b = await chromium.launch({ executablePath: EXE })
const p = await b.newPage()
await p.addInitScript(([s,t]) => { localStorage.setItem('localfit-state', s); const RD=Date; const f=new RD(t+'T14:00:00'); class D extends RD{constructor(...a){if(!a.length)super(f.getTime());else super(...a)} static now(){return f.getTime()}} window.Date=D }, [JSON.stringify(state), today])
await p.goto('http://localhost:4390/', { waitUntil:'networkidle' }); await p.waitForTimeout(700)
const prompt = await p.evaluate(()=>document.body.innerText.includes('starts today') && document.body.innerText.includes('Strength & Lean'))
console.log('pre-phase prompt shown:', prompt)
await p.evaluate(()=>{ const btn=[...document.querySelectorAll('button')].find(b=>/Start Phase 2 today/.test(b.textContent||'')); btn?.click() })
await p.waitForTimeout(500)
const prof = await p.evaluate(()=>JSON.parse(localStorage.getItem('localfit-state')).profile)
console.log('after start -> phase:', JSON.stringify(prof.phase), '| deficit:', prof.deficit, '| gymTarget:', prof.gymTargetPerWeek, '| ppk:', JSON.stringify(prof.proteinPerKg))
const cc = await p.evaluate(()=>{ let el=[...document.querySelectorAll('section')].find(s=>/command center/i.test(s.innerText||'')); return el?el.innerText:'(no cc)' })
console.log('COMMAND CENTER:\n'+cc)
await b.close()
