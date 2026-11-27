const { chromium } = await import(process.env.MST_QA_PLAYWRIGHT_MODULE || 'playwright');
import { writeFileSync } from 'node:fs';
const origin=process.env.MST_PERF_ORIGIN || 'https://stellar-testnet.multisig.tools/';
const browser=await chromium.launch({headless:true});
const runs=[];
try {
 for(let i=0;i<3;i++){
  const c=await browser.newContext({viewport:{width:390,height:844},serviceWorkers:'block'});
  try{
   const p=await c.newPage();
   const session=await c.newCDPSession(p);
   await session.send('Network.enable');
   await session.send('Network.setCacheDisabled',{cacheDisabled:true});
   await session.send('Emulation.setCPUThrottlingRate',{rate:4});
   const errors=[];p.on('pageerror',e=>errors.push(e.message));
   await p.goto(origin,{waitUntil:'domcontentloaded',timeout:45000});
   await p.getByRole('heading',{name:'Manage shared Stellar accounts.'}).waitFor({timeout:30000});
   await p.waitForTimeout(2500);
   const report=await p.evaluate(()=>({
    paint:performance.getEntriesByType('paint').map(e=>({name:e.name,ms:e.startTime})),
    js:performance.getEntriesByType('resource').filter(e=>new URL(e.name).pathname.endsWith('.js')).map(e=>({name:new URL(e.name).pathname,decoded:e.decodedBodySize,encoded:e.encodedBodySize,transfer:e.transferSize})),
    all:performance.getEntriesByType('resource').length,
    horizontalOverflow:document.documentElement.scrollWidth>innerWidth,
   }));
   const result={...report,errors,decodedJs:report.js.reduce((s,e)=>s+e.decoded,0),encodedJs:report.js.reduce((s,e)=>s+e.encoded,0),jsRequests:report.js.length};
   runs.push(result);console.log(JSON.stringify(result));
  }finally{await c.close();}
 }
}finally{await browser.close();writeFileSync(process.env.MST_PERF_OUTPUT||'initial-load-report.json',JSON.stringify(runs,null,2));}
if(runs.some(r=>r.errors.length||r.horizontalOverflow||r.decodedJs>350000||r.jsRequests>2))process.exitCode=1;
