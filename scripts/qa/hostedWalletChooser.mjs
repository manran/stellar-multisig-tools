const { chromium } = await import(process.env.MST_QA_PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
const origin=process.env.MST_QA_ORIGIN ?? 'https://stellar-testnet.multisig.tools/';
const output=process.env.MST_QA_OUTPUT ?? '/artifacts';
await mkdir(output,{recursive:true});
const browser=await chromium.launch({headless:true});
const results=[];
try {
  for (const [width,colorScheme] of [[375,'light'],[1280,'light'],[375,'dark'],[1280,'dark']]) {
    const context=await browser.newContext({viewport:{width,height:900},colorScheme});
    try {
      const page=await context.newPage();
      if(process.env.MST_QA_AXE_PATH) await page.addInitScript({path:process.env.MST_QA_AXE_PATH});
      await page.goto(origin,{waitUntil:'domcontentloaded',timeout:30000});
      const opener=page.locator('header').getByRole('button',{name:'Connect wallet',exact:true});
      await opener.click({timeout:15000});
      const dialog=page.getByRole('dialog',{name:'Choose a wallet'});
      await dialog.waitFor({state:'visible',timeout:15000});
      const rows=dialog.locator('li[role=button]');
      await rows.first().waitFor({state:'visible',timeout:20000});
      const count=await rows.count();
      assert.equal(count,await dialog.locator('section.stellar-wallets-kit li').count());
      assert.ok(await rows.evaluateAll(es=>es.every(e=>e.tabIndex===0)));
      await dialog.locator('button').first().focus();
      const reached=new Set();
      for(let i=0;i<count+6;i++){
        await page.keyboard.press('Tab');
        const focus=await page.evaluate(()=>({inside:document.activeElement===document.body||!!document.activeElement?.closest('dialog[open]'),row:document.activeElement?.matches('li[role=button]')?document.activeElement.textContent?.trim():null}));
        assert.ok(focus.inside,'focus escaped modal');
        if(focus.row)reached.add(focus.row);
      }
      assert.equal(reached.size,count,'every wallet row is reachable with Tab');
      const audit=process.env.MST_QA_AXE_PATH?await page.evaluate(async()=>{const r=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});return{violations:r.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>({target:n.target,summary:n.failureSummary}))})),incomplete:r.incomplete.map(v=>({id:v.id,nodes:v.nodes.length}))}}):null;
      await page.screenshot({path:output+'/chooser-'+width+'-'+colorScheme+'.png'});
      await page.keyboard.press('Escape');
      await dialog.waitFor({state:'detached',timeout:15000});
      await page.waitForFunction(()=>document.activeElement?.closest('header') && document.activeElement.textContent?.includes('Connect wallet'),{},{timeout:5000});
      const result={width,colorScheme,count,reachable:reached.size,audit}; results.push(result); console.log(JSON.stringify(result));
    }finally{await context.close();}
  }
}finally{await browser.close();await writeFile(output+'/wallet-chooser.json',JSON.stringify(results,null,2));}
if(results.some(r=>r.audit?.violations.length))process.exitCode=1;
