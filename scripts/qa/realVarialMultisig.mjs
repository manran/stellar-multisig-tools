/** Real, isolated Varial extension 2-of-2 Testnet E2E. Not part of routine CI. */
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

if (process.env.MST_VARIAL_LIVE_E2E !== '1') throw new Error('Set MST_VARIAL_LIVE_E2E=1 to enable real Testnet transactions.');
const EXT = process.env.MST_VARIAL_EXTENSION_DIR;
const playwrightModule = process.env.MST_VARIAL_PLAYWRIGHT_MODULE;
if (!EXT || !playwrightModule) throw new Error('Set MST_VARIAL_EXTENSION_DIR and MST_VARIAL_PLAYWRIGHT_MODULE.');
const { chromium } = await import(playwrightModule);
const manifest = JSON.parse(await fs.readFile(join(EXT, 'manifest.json'), 'utf8'));
if (!/Varial/i.test(manifest.name)) throw new Error('Expected the official unpacked Varial extension.');
const extensionVersion = String(manifest.version);
const PROFILE_ROOT = await fs.mkdtemp(join(tmpdir(), 'mst-varial-live-'));
const walletPasswords = new WeakMap();

function log(step, details = {}) {
  console.log(JSON.stringify({ step, ...details }));
}


async function waitFor(fn, timeout = 20000, interval = 150) {
  const until = Date.now() + timeout;
  let last;
  while (Date.now() < until) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) { last = error; }
    await new Promise((r) => setTimeout(r, interval));
  }
  throw last ?? new Error('Timed out waiting for condition.');
}

async function unlockFreighterIfNeeded(context) {
  const password = walletPasswords.get(context);
  if (!password) return false;
  for (const page of context.pages()) {
    if (!page.url().startsWith('chrome-extension://')) continue;
    const body = await page.locator('body').innerText().catch(() => '');
    if (!/Enter password to unlock Freighter/i.test(body)) continue;
    const input = page.locator('input[name=password], input[type=password]').first();
    const unlock = page.getByRole('button', { name: 'Unlock', exact: true }).first();
    if (!await input.count() || !await unlock.count()) continue;
    await input.fill(password);
    await unlock.click({ force: true });
    log('freighter_unlocked');
    return true;
  }
  return false;
}

async function extensionPrompt(context, expected, timeout = 20000) {
  return waitFor(async () => {
    if (await unlockFreighterIfNeeded(context)) return null;
    for (const page of context.pages()) {
      if (!page.url().startsWith('chrome-extension://')) continue;
      const body = await page.locator('body').innerText().catch(() => '');
      if (!expected.test(body)) continue;
      return { page, body };
    }
    return null;
  }, timeout);
}

async function approvePrompt(context, expected) {
  let prompt;
  try {
    prompt = await extensionPrompt(context, expected);
  } catch (error) {
    log('varial_prompt_not_found', {
      expected: expected.source,
      extensionPages: context.pages().filter((page) => page.url().startsWith('chrome-extension://')).length,
    });
    throw error;
  }
  const { page, body } = prompt;
  if (/Connection Request|Confirm Transaction|Confirm Authorizations|Sign message/i.test(body)
      && !/Test Net|Testnet/i.test(body)) {
    throw new Error('Varial prompt is not on Testnet');
  }
  let action = '';
  for (const label of ['Connect', 'Confirm', 'Sign', 'Approve']) {
    const button = page.getByRole('button', { name: label, exact: true });
    if (await button.count() && await button.first().isVisible()) {
      action = label;
      await button.first().click();
      break;
    }
  }
  if (!action) throw new Error('No approval button found in Varial prompt');
  log('freighter_prompt', { kind: body.split('\n').slice(0, 3).join(' / '), action });
  return body;
}

async function createWallet(label) {
  const profile = `${PROFILE_ROOT}/mst-varial-${label}`;
  const context = await chromium.launchPersistentContext(profile, {
    headless: false,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
  });
  await context.addInitScript(() => {
    if (location.protocol === 'chrome-extension:') {
      try {
        navigator.clipboard.writeText = async (text) => { globalThis.__fedCopied = String(text); };
      } catch {}
    }
  });
  let workers = context.serviceWorkers();
  if (!workers.length) workers = [await context.waitForEvent('serviceworker')];
  const extensionId = new URL(workers[0].url()).host;
  const origin = `chrome-extension://${extensionId}`;
  const password = `A${crypto.randomUUID()}a1!`;
  walletPasswords.set(context, password);

  const onboarding = await context.newPage();
  await onboarding.goto(`${origin}/index.html`);
  await onboarding.getByRole('button', { name: 'Create new wallet' }).click();
  await onboarding.locator('input[name=password]').fill(password);
  await onboarding.locator('input[name=confirmPassword]').fill(password);
  await onboarding.locator('input[name=termsOfUse]').check({ force: true });
  await onboarding.getByRole('button', { name: 'Confirm' }).click();
  await onboarding.getByRole('button', { name: 'Do this later' }).click();
  await onboarding.waitForTimeout(350);

  const details = await context.newPage();
  await details.goto(`${origin}/index.html`);
  await details.waitForTimeout(500);
  await details.getByTestId('account-chip').click();
  await details.getByTestId('wallets-header-copy').click();
  const address = await details.evaluate(() => globalThis.__fedCopied || '');
  if (!/^G[A-Z2-7]{55}$/.test(address)) throw new Error(`${label}: failed to capture public address`);

  const friendbot = await fetch(`https://friendbot.stellar.org?addr=${encodeURIComponent(address)}`);
  if (!friendbot.ok) throw new Error(`${label}: Friendbot failed ${friendbot.status}`);

  const network = await context.newPage();
  await network.goto(`${origin}/index.html`);
  await network.waitForTimeout(500);
  await network.getByTestId('account-chip').click();
  await network.getByTestId('account-sheet-settings').click();
  await network.getByTestId('settings-network-link').click();
  await network.getByTestId('network-settings-select').selectOption('Test Net');
  await network.getByTestId('BackButton').click();
  await network.getByTestId('BackButton').click();
  await network.waitForTimeout(700);

  log('autolock_profile_default', { extension: extensionVersion });

  await onboarding.close();
  await details.close();
  await network.close();
  log('wallet_ready', { label, address });
  return { label, context, profile, address };
}

const require=createRequire(import.meta.url);
const {Keypair,Horizon,Networks,Operation,TransactionBuilder,Asset}=require('@stellar/stellar-sdk');
const horizon=new Horizon.Server('https://horizon-testnet.stellar.org');
const mst='https://stellar-testnet.multisig.tools';
let a=null,b=null;let pA=null,pB=null;
const EMAIL_LIVE = process.env.MST_VARIAL_EMAIL_E2E === '1';
const TEST_EMAIL = 'delivered@resend.dev';
let contactSaved=false;
let mailStatus='not_tested';
async function mstApi(page, path, method, body, requestId='', capability='', address='') {
 const result=await page.evaluate(async input=>{
  const headers={'content-type':'application/json',...(input.address?{'x-multisig-session-address':input.address}:{}),...(input.requestId?{'X-MultiSig-Request-Id':input.requestId}:{}),...(input.capability?{'X-MultiSig-Capability':input.capability}:{})};
  const r=await fetch(input.path,{method:input.method,credentials:'include',headers,...(input.body!==undefined?{body:JSON.stringify(input.body)}:{})});
  const b=await r.json().catch(()=>({}));return {status:r.status,body:b};
 },{path,method,body,requestId,capability,address});
 if(result.status<200||result.status>=300)throw new Error(`${method} ${path} status ${result.status}: ${result.body?.code||result.body?.error||'unknown'}`);
 return result.body;
}
async function coordination(page,id,cap,address) {
 return mstApi(page,'/api/request','GET',undefined,id,cap,address);
}
async function waitEmailState(page,id,cap,address,states,timeoutMs=20000) {
 const until=Date.now()+timeoutMs;let last='unavailable';
 while(Date.now()<until){
  const body=await coordination(page,id,cap,address);
  const notifications=body.coordination?.notifications||[];
  const latest=notifications.find(x=>x.signerAddress===b.address);
  last=latest?.state||'none';
  if(states.includes(last))return latest;
  await new Promise(r=>setTimeout(r,1500));
 }
 log('notification_status_timeout',{expected:states,last});return last;
}


const ui=async(p)=>({headings:(await p.locator('h1,h2,h3').allTextContents()).map(x=>x.trim()).slice(0,9),buttons:(await p.getByRole('button').allTextContents()).map(x=>x.trim()).filter(Boolean).slice(0,19),alerts:(await p.getByRole('alert').allTextContents()).slice(0,4)});
async function loginMst(wallet){
  const page=await wallet.context.newPage();
  await page.goto(mst+'/inbox',{waitUntil:'domcontentloaded',timeout:25000});
  await page.getByRole('button',{name:'Connect wallet'}).first().click();
  await page.getByText('Varial',{exact:true}).first().click();
  await approvePrompt(wallet.context,/Connection Request/i);
  await approvePrompt(wallet.context,/Sign message|Confirm Transaction/i);
  await page.getByRole('heading',{name:'Inbox'}).waitFor({state:'visible',timeout:15000});
  log('mst_authenticated',{wallet:wallet.label,address:wallet.address});
  return page;
}
try{
 a=await createWallet('mst-a'); b=await createWallet('mst-b');
 const treasury=Keypair.random();
 let fund=await fetch('https://friendbot.stellar.org?addr='+encodeURIComponent(treasury.publicKey()));
 if(!fund.ok)throw new Error('Treasury Friendbot failed '+fund.status);
 const account=await horizon.loadAccount(treasury.publicKey());
 const configure=new TransactionBuilder(account,{fee:'100',networkPassphrase:Networks.TESTNET})
 .addOperation(Operation.setOptions({signer:{ed25519PublicKey:a.address,weight:1}}))
 .addOperation(Operation.setOptions({signer:{ed25519PublicKey:b.address,weight:1}}))
 .addOperation(Operation.setOptions({masterWeight:0,lowThreshold:1,medThreshold:2,highThreshold:2}))
 .setTimeout(180).build();
 configure.sign(treasury);
 const configured=await horizon.submitTransaction(configure);
 const live=await horizon.loadAccount(treasury.publicKey());
 if(live.thresholds.med_threshold!==2||![a.address,b.address].every(x=>live.signers.some(y=>y.key===x&&y.weight===1)))throw new Error('Treasury policy mismatch');
 log('treasury_ready',{address:treasury.publicKey(),signers:2,threshold:2,setupTransaction:configured.hash});
 const pay=new TransactionBuilder(live,{fee:'100',networkPassphrase:Networks.TESTNET})
 .addOperation(Operation.payment({destination:a.address,asset:Asset.native(),amount:'0.0500000'})).setTimeout(900).build();
 const unsignedXdr=pay.toEnvelope().toXDR('base64');
 pA=await loginMst(a);
 await pA.goto(mst+'/new/import',{waitUntil:'domcontentloaded'});
 await pA.locator('#import-xdr').fill(unsignedXdr);
 await pA.getByRole('button',{name:/Review transaction/i}).click();
 await pA.getByRole('button',{name:'Continue to signatures'}).waitFor({state:'visible',timeout:35000});
 log('import_review_ready');
 await pA.getByRole('button',{name:'Continue to signatures'}).click();
 await approvePrompt(a.context,/Sign message|Confirm Transaction/i);
 log('mst_review_wallet_reconfirmed');
 await pA.waitForURL(u=>u.pathname.endsWith('/s')&&u.hash.length>20,{timeout:35000});
 const shareUrl=pA.url();
 log('mst_proposal_created',{id:new URL(shareUrl).hash.slice(1,17)});
 await pA.getByRole('button',{name:'Sign',exact:true}).waitFor({state:'visible',timeout:35000});
 await pA.getByRole('button',{name:'Sign',exact:true}).click();
 await approvePrompt(a.context,/Confirm Transaction/i);
 await pA.getByRole('button',{name:'Signed',exact:true}).waitFor({state:'visible',timeout:30000});
 log('mst_owner_signed');
 if(EMAIL_LIVE){
 const id=new URL(shareUrl).hash.slice(1,17);
 const cap=new URL(shareUrl).hash.slice(17);
 if(!/^[A-Za-z0-9_-]{16}$/.test(id)||!cap)throw new Error('Unexpected private proposal locator');
 const contact=await mstApi(pA,'/api/address-book','PUT',{address:b.address,subject_type:'signer',label:'Varial E2E Test Recipient',notification_email:TEST_EMAIL},'','',a.address);
 if(contact.entry?.notification_email!==TEST_EMAIL)throw new Error('Contact not stored');
 contactSaved=true;
 log('test_contact_saved',{recipient:'resend_synthetic_delivery'});
 const asked=await mstApi(pA,'/api/request','PATCH',{assignSigner:b.address},id,cap,a.address);
 log('email_invitation',{status:asked.notification?.status,assignments:asked.coordination?.assignments?.length});
 if(!['queued','already_queued'].includes(asked.notification?.status))throw new Error('Initial email was not queued');
 let delivered=await waitEmailState(pA,id,cap,a.address,['delivered','provider_accepted']);
 mailStatus=typeof delivered==='string' ? delivered : delivered?.state??'not_reported';
 log('email_invitation_provider_state',{state:mailStatus});
 const reminded=await mstApi(pA,'/api/request','PATCH',{remindSigner:b.address},id,cap,a.address);
 log('email_reminder',{status:reminded.notification?.status});
 if(reminded.notification?.status!=='queued')throw new Error('Reminder email was not queued');
 const reminderEvidence=await waitEmailState(pA,id,cap,a.address,['delivered','provider_accepted']);
 const reminderState=typeof reminderEvidence==='string' ? reminderEvidence : reminderEvidence?.state??'not_reported';
 log('email_reminder_provider_state',{state:reminderState});
 mailStatus=([mailStatus,reminderState].every(state=>['delivered','provider_accepted'].includes(state)))?'provider_accepted':'unconfirmed';
 const nonSecretEmailLink=mst+'/s#'+id;
 if(nonSecretEmailLink.includes(cap))throw new Error('Email locator leaked capability');
 log('email_cta_locator_ready',{proposalId:id,containsBearer:false});
 }

 pB=await loginMst(b);
 await pB.goto(EMAIL_LIVE ? mst+'/s#'+new URL(shareUrl).hash.slice(1,17) : shareUrl,{waitUntil:'domcontentloaded'});
 if(EMAIL_LIVE)log('recipient_email_locator_opened',{hasCapability:false});
 await pB.waitForTimeout(1200);
 const open=pB.getByRole('button',{name:/Open proposal|Open transaction/i}).first();
 if(await open.count()&&await open.isVisible()){
  await open.click();
  if(EMAIL_LIVE)await approvePrompt(b.context,/Sign message|Confirm Transaction/i).catch(()=>{});
 }
 if(EMAIL_LIVE){
  const coordinationState=await coordination(pA,new URL(shareUrl).hash.slice(1,17),new URL(shareUrl).hash.slice(17),a.address);
  const wasViewed=Boolean(coordinationState.coordination?.assignments?.find(x=>x.signerAddress===b.address)?.viewedAt);
  log('recipient_viewed',{recorded:wasViewed});
  if(!wasViewed)throw new Error('Recipient Viewed fact not recorded');
 }
 const reviewContinue=pB.getByRole('button',{name:'Continue to signatures'}).first();
 if(await reviewContinue.count()&&await reviewContinue.isVisible()){await reviewContinue.click();log('mst_recipient_reviewed');}
 await pB.getByRole('button',{name:'Sign',exact:true}).waitFor({state:'visible',timeout:35000});
 await pB.getByRole('button',{name:'Sign',exact:true}).click();
 await approvePrompt(b.context,/Confirm Transaction/i);
 await pB.waitForTimeout(1500);
 log('mst_recipient_signed',{ui:await ui(pB)});
 const route=pB.getByRole('button',{name:'MultiSigTools submits'});
 if(await route.count())await route.click();
 await pB.getByRole('button',{name:'Submit transaction',exact:true}).waitFor({state:'visible',timeout:20000});
 await pB.getByRole('button',{name:'Submit transaction',exact:true}).click();
 await pB.getByText('Transaction confirmed',{exact:true}).waitFor({state:'visible',timeout:35000});
 const recent=await horizon.transactions().forAccount(treasury.publicKey()).order('desc').limit(5).call();
 let found=null;
 for(const tx of recent.records){
   if(!tx.successful||tx.hash===configured.hash)continue;
   const operations=await horizon.operations().forTransaction(tx.hash).call();
   if(operations.records.some(op=>op.type==='payment'&&op.from===treasury.publicKey()&&op.to===a.address&&op.amount==='0.0500000'&&op.asset_type==='native')){found=tx;break}
 }
 if(!found)throw new Error('Testnet payment not found or incorrect');
 const receiptResponse=await fetch('https://horizon-testnet.stellar.org/transactions/'+found.hash);
 if(!receiptResponse.ok)throw new Error('Horizon receipt lookup failed '+receiptResponse.status);
 const receipt=await receiptResponse.json();
 if(!receipt.successful||!Number.isInteger(receipt.ledger))throw new Error('Horizon receipt not confirmed');
 log('MST_VARIAL_REAL_MULTISIG_PASS',{transactionHash:receipt.hash,ledger:receipt.ledger,treasury:treasury.publicKey(),walletVersion:extensionVersion});
 if(EMAIL_LIVE && mailStatus==='unconfirmed')throw new Error('Wallet and chain PASS; email invite/reminder still queued with no provider acceptance/delivery evidence');

}catch(e){
 log('MST_VARIAL_E2E_FAILED',{message:String(e.message).slice(0,330)});
 if(pA)log('MST_A_LAST_UI',await ui(pA).catch(()=>({unavailable:true})));
 if(pB)log('MST_B_LAST_UI',await ui(pB).catch(()=>({unavailable:true})));
 process.exitCode=1;
}finally{
 if(contactSaved && pA && a && b){
   await mstApi(pA,'/api/address-book','DELETE',{address:b.address,subject_type:'signer'},'','',a.address).catch(()=>{});
   log('test_contact_cleanup');
 }
 for(const wallet of [a,b]){if(wallet){await wallet.context.close().catch(()=>{});await fs.rm(wallet.profile,{recursive:true,force:true}).catch(()=>{})}}
 await fs.rm(PROFILE_ROOT,{recursive:true,force:true}).catch(()=>{});
}
