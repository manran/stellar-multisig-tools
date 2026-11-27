/** Real, isolated Varial extension 2-of-2 Testnet E2E for Classic or --soroban, including signature rejection. Not part of routine CI. */
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
const {Keypair,Horizon,Networks,Operation,TransactionBuilder,Asset,rpc}=require('@stellar/stellar-sdk');
const SOROBAN_LIVE=process.argv.includes('--soroban');
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
async function waitEmailState(page,id,cap,address,eventType,states,timeoutMs=20000) {
 const until=Date.now()+timeoutMs;let last='unavailable';
 while(Date.now()<until){
  const body=await coordination(page,id,cap,address);
  const notifications=body.coordination?.notifications||[];
  const latest=notifications.find(x=>x.signerAddress===b.address && x.eventType===eventType);
  last=latest?.state||'none';
  if(states.includes(last))return latest;
  await new Promise(r=>setTimeout(r,1500));
 }
 log('notification_status_timeout',{eventType,expected:states,last});return last;
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
// The same isolated real extension profiles exercise detached AUTH and the
// final, separately signed Soroban envelope. No software signer supplies AUTH.
async function intentApi(page, address, id, method='GET', body) {
 const result=await page.evaluate(async ({address,id,method,body})=>{
  const r=await fetch('/api/intent'+(method==='GET'?'?includeMetadata=1':''),{
   method,credentials:'include',cache:'no-store',
   headers:{'Content-Type':'application/json','x-multisig-session-address':address,...(id?{'X-MultiSig-Intent-Id':id}:{})},
   ...(body===undefined?{}:{body:JSON.stringify(body)}),
  });
  const data=await r.json().catch(()=>({}));
  return {status:r.status,data};
 },{address,id,method,body});
 if(result.status<200||result.status>=300)throw new Error('Intent '+method+' HTTP '+result.status+': '+(result.data.code||result.data.error||'unknown'));
 return result.data;
}
function invariant(value,message){if(!value)throw new Error(message);}
function nativeBalance(account){
 const amount=account.balances.find(b=>b.asset_type==='native')?.balance;
 invariant(typeof amount==='string','Missing native balance');
 const [whole,fraction='']=amount.split('.');
 return BigInt(whole)*10000000n+BigInt(fraction.padEnd(7,'0'));
}
async function realSoroban(treasury){
 const source=treasury.publicKey(),destination=a.address;
 pA=await loginMst(a);
 pB=await loginMst(b);
 const beforeBalance=nativeBalance(await horizon.loadAccount(destination));
 const created=await intentApi(pA,a.address,'','POST',{network:'testnet',
  contractId:Asset.native().contractId(Networks.TESTNET),method:'transfer',
  arguments:{from:source,to:destination,amount:'5000000'}});
 const id=created.intent?.id;
 invariant(/^[0-9A-HJKMNP-TV-Z]{16}$/.test(id),'Invalid Intent ID');
 invariant(created.authorization?.status==='awaiting_authorization','New Intent must await AUTH');
 const url=mst+'/a#'+id;
 log('soroban_intent_created',{id,source,destination});
 const inspect=(page,wallet)=>intentApi(page,wallet.address,id);
 for(const [index,page,wallet] of [[1,pA,a],[2,pB,b]]){
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Send 0.5 XLM',exact:true}).waitFor({state:'visible',timeout:35000});
  const button=page.getByRole('button',{name:'Authorize contract Intent',exact:true});
  await button.waitFor({state:'visible',timeout:35000});
  const initial=await inspect(page,wallet);
  invariant(initial.callSummary?.nativeXlmTransfer?.amount==='0.5' &&
   initial.callSummary.nativeXlmTransfer.from===source && initial.callSummary.nativeXlmTransfer.to===destination,'Intent review summary mismatch');
  if(index===1){
   await button.click();
   const refusal=await extensionPrompt(wallet.context,/Confirm Authorizations?|Confirm Authorization|Sign Authorization/i,30000);
   invariant(/Test Net|Testnet/i.test(refusal.body),'AUTH refusal prompt is not on Testnet');
   const reject=refusal.page.getByRole('button',{name:/^(Reject|Cancel|Decline|Deny)$/i}).first();
   await reject.waitFor({state:'visible',timeout:10000});
   await reject.click();
   await button.waitFor({state:'visible',timeout:15000});
   await waitFor(()=>button.isEnabled(),15000);
   const unchanged=await inspect(page,wallet);
   invariant(unchanged.authorization.contributionCount===0 && unchanged.authorization.status==='awaiting_authorization' &&
    unchanged.intent.authorizationPlan.authorizationPlanDigest===initial.intent.authorizationPlan.authorizationPlanDigest,'Rejected AUTH changed the plan or contributions');
   log('soroban_auth_rejected_without_mutation');
  }
  await button.click();
  await approvePrompt(wallet.context,/Confirm Authorizations?|Confirm Authorization|Sign Authorization/i);
  const expected=index===1?'awaiting_authorization':'authorization_ready';
  const approved=await waitFor(async()=>{
   const state=await inspect(page,wallet);
   return state.authorization.contributionCount===index && state.authorization.status===expected?state:null;
  },35000);
  invariant(approved.authorization.authorizers.some(item=>item.authorizer===source && item.signedWeight===index && item.threshold===2 &&
   item.signerEvidence.some(signer=>signer.publicKey===wallet.address)),'Incorrect AUTH signer evidence or weight');
  log('soroban_real_wallet_auth',{signer:index,status:expected});
 }
 const prepare=pB.getByRole('button',{name:'Continue with this wallet',exact:true});
 await prepare.waitFor({state:'visible',timeout:35000});
 const capture=pB.waitForResponse(r=>r.url().includes('/api/intent') && r.request().method()==='PUT' && r.ok(),{timeout:45000});
 await prepare.click();
 const prepared=(await (await capture).json()).execution;
 invariant(prepared?.xdr && prepared.executionSource===b.address,'Missing executor package');
 const envelope=TransactionBuilder.fromXDR(prepared.xdr,Networks.TESTNET);
 invariant(envelope.source===b.address && Buffer.from(envelope.hash()).toString('hex')===prepared.transactionHash,'Prepared envelope identity mismatch');
 await pB.waitForURL(u=>u.pathname.endsWith('/signing-room'),{timeout:35000});
 // Leave without signing and recover the exact same released envelope.
 await pB.goto(url,{waitUntil:'domcontentloaded'});
 const resume=pB.getByRole('button',{name:'Resume signing',exact:true});
 await resume.waitFor({state:'visible',timeout:35000});
 const response=pB.waitForResponse(r=>r.url().includes('/api/intent')&&r.request().method()==='PUT'&&r.ok(),{timeout:35000});
 await resume.click();
 const recovered=(await (await response).json()).execution;
 invariant(recovered?.xdr===prepared.xdr && recovered.transactionHash===prepared.transactionHash &&
  recovered.transactionSequence===prepared.transactionSequence && recovered.validUntil===prepared.validUntil,'Resume changed released Soroban envelope');
 log('soroban_real_wallet_resume',{transactionHash:prepared.transactionHash});
 await pB.waitForURL(u=>u.pathname.endsWith('/signing-room'),{timeout:35000});
 const next=pB.getByRole('button',{name:'Continue to signatures',exact:true});
 await next.waitFor({state:'visible',timeout:35000});
 await next.click();
 const transition=await waitFor(async()=>{
  if(new URL(pB.url()).pathname.endsWith('/s'))return 'session_reused';
  for(const page of b.context.pages()){
   if(page.url().startsWith('chrome-extension://')&&/Sign message|Confirm Transaction/i.test(await page.locator('body').innerText().catch(()=>'')))return 'confirmation_required';
  }
  return null;
 },35000);
 if(transition==='confirmation_required')await approvePrompt(b.context,/Sign message|Confirm Transaction/i);
 await pB.waitForURL(u=>u.pathname.endsWith('/s')&&u.hash.length>20,{timeout:35000});
 const locator=new URL(pB.url()).hash.slice(1);
 const requestId=locator.slice(0,16),cap=locator.slice(16);
 const snapshot=()=>coordination(pB,requestId,cap,b.address);
 const unsigned=await snapshot();
 invariant(unsigned.request.transactionHash===prepared.transactionHash && unsigned.request.signatureCount===0,'Final Proposal did not preserve the released envelope');
 const sign=pB.getByRole('button',{name:'Sign',exact:true});
 await sign.waitFor({state:'visible',timeout:35000});
 await sign.click();
 await approvePrompt(b.context,/Confirm Transaction/i);
 const ready=await waitFor(async()=>{
  const state=await snapshot();
  return state.request.signatureCount===1 && ['ready','submitted'].includes(state.request.status)?state.request:null;
 },35000);
 invariant(ready.transactionHash===prepared.transactionHash,'Envelope signature changed the hash');
 log('soroban_real_wallet_envelope_signed',{requestId,transactionHash:ready.transactionHash});
 if(ready.status==='ready'){
  const route=pB.getByRole('button',{name:/MultiSigTools submits/});
  const submit=pB.getByRole('button',{name:'Submit transaction',exact:true});
  const action=await waitFor(async()=>await submit.isVisible()?'submit':await route.isVisible()?'route':null,35000);
  if(action==='route')await route.click();
  await submit.waitFor({state:'visible',timeout:35000});
  await submit.click();
 }
 await pB.getByText('Transaction confirmed',{exact:true}).first().waitFor({state:'visible',timeout:45000});
 const chain=await new rpc.Server('https://soroban-testnet.stellar.org',{timeout:15000}).getTransaction(prepared.transactionHash);
 invariant(chain.status==='SUCCESS' && Number.isInteger(chain.ledger),'Soroban RPC did not confirm the exact hash');
 const afterBalance=nativeBalance(await horizon.loadAccount(destination));
 invariant(afterBalance-beforeBalance===5000000n,'Recipient did not receive exactly 0.5 XLM');
 const reconciled=await intentApi(pB,b.address,id,'PUT',{action:'reconcile_execution',transactionHash:prepared.transactionHash});
 invariant(reconciled.outcome==='successful' && reconciled.observation?.successful===true && reconciled.observation.ledger===chain.ledger,'MST reconciliation differs from RPC receipt');
 for(const [page,wallet] of [[pA,a],[pB,b]]){
  await page.goto(url,{waitUntil:'domcontentloaded'});
  await page.getByRole('heading',{name:'Transaction confirmed',exact:true}).waitFor({state:'visible',timeout:35000});
  const complete=await inspect(page,wallet);
  invariant(complete.authorization.status==='completed'&&!complete.authorization.authorizationEntriesXdr.length&&!complete.challenges?.length,'Historical contributor receipt missing or AUTH leaked');
 }
 log('MST_VARIAL_REAL_SOROBAN_PASS',{intentId:id,requestId,transactionHash:prepared.transactionHash,ledger:chain.ledger,amount:'0.5 XLM',walletVersion:extensionVersion});
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
 .addOperation(Operation.setOptions({masterWeight:0,lowThreshold:SOROBAN_LIVE?2:1,medThreshold:2,highThreshold:2}))
 .setTimeout(180).build();
 configure.sign(treasury);
 const configured=await horizon.submitTransaction(configure);
 const live=await horizon.loadAccount(treasury.publicKey());
 if(live.thresholds.med_threshold!==2||![a.address,b.address].every(x=>live.signers.some(y=>y.key===x&&y.weight===1)))throw new Error('Treasury policy mismatch');
 log('treasury_ready',{address:treasury.publicKey(),signers:2,threshold:2,setupTransaction:configured.hash});
 if(SOROBAN_LIVE){
  await realSoroban(treasury);
 }else{
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
 const proposalReady=()=>new URL(pA.url()).pathname.endsWith('/s')&&new URL(pA.url()).hash.length>20;
 const handoff=await waitFor(async()=>{
  if(proposalReady())return 'session_reused';
  if(await unlockFreighterIfNeeded(a.context))return null;
  for(const page of a.context.pages()){
   if(!page.url().startsWith('chrome-extension://'))continue;
   const body=await page.locator('body').innerText().catch(()=> '');
   if(/Sign message|Confirm Transaction/i.test(body))return 'confirmation_required';
  }
  return null;
 },35000);
 if(handoff==='confirmation_required')await approvePrompt(a.context,/Sign message|Confirm Transaction/i);
 await pA.waitForURL(u=>u.pathname.endsWith('/s')&&u.hash.length>20,{timeout:35000});
 log('mst_review_handoff',{mode:handoff});
 const shareUrl=pA.url();
 log('mst_proposal_created',{id:new URL(shareUrl).hash.slice(1,17)});
 const signA=pA.getByRole('button',{name:'Sign',exact:true});
 await signA.waitFor({state:'visible',timeout:35000});
 const locator=new URL(shareUrl).hash.slice(1);
 const requestId=locator.slice(0,16),capability=locator.slice(16);
 const before=await coordination(pA,requestId,capability,a.address);
 await signA.click();
 const refusal=await extensionPrompt(a.context,/Confirm Transaction/i);
 if(!/Test Net|Testnet/i.test(refusal.body))throw new Error('Refusal prompt is not on Testnet');
 const reject=refusal.page.getByRole('button',{name:/^(Reject|Cancel|Decline|Deny)$/i}).first();
 await reject.waitFor({state:'visible',timeout:10000});
 await reject.click();
 await waitFor(()=>signA.isEnabled().catch(()=>false),15000);
 const after=await coordination(pA,requestId,capability,a.address);
 if(before.request?.signatureCount!==0||after.request?.signatureCount!==before.request.signatureCount||
    after.request?.transactionHash!==before.request.transactionHash||after.request?.status!=='awaiting_signatures'){
  throw new Error('Rejected wallet prompt changed the proposal or its signature count');
 }
 if((await pA.locator('body').innerText()).includes('The user rejected this request.'))throw new Error('Raw wallet rejection leaked into the UI');
 log('mst_signature_rejected_without_mutation',{signatureCount:after.request.signatureCount});
 await signA.click();
 await approvePrompt(a.context,/Confirm Transaction/i);
 await pA.getByRole('heading',{name:'Your signature is recorded',exact:true}).waitFor({state:'visible',timeout:30000});
 const first=await waitFor(async()=>{
  const state=await coordination(pA,requestId,capability,a.address);
  return state.request?.signatureCount===1 && state.request.status==='awaiting_signatures' ? state.request : null;
 },15000);
 if(first.transactionHash!==before.request.transactionHash)throw new Error('First signature changed the transaction hash');
 log('mst_owner_signed',{signatureCount:first.signatureCount});
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
 let delivered=await waitEmailState(pA,id,cap,a.address,'signature_requested',['delivered','provider_accepted']);
 mailStatus=typeof delivered==='string' ? delivered : delivered?.state??'not_reported';
 log('email_invitation_provider_state',{state:mailStatus});
 const reminded=await mstApi(pA,'/api/request','PATCH',{remindSigner:b.address},id,cap,a.address);
 log('email_reminder',{status:reminded.notification?.status});
 if(reminded.notification?.status!=='queued')throw new Error('Reminder email was not queued');
 const reminderEvidence=await waitEmailState(pA,id,cap,a.address,'signature_reminder',['delivered','provider_accepted']);
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
 const open=pB.getByRole('button',{name:/Open proposal|Open transaction/i}).first();
 const reviewContinue=pB.getByRole('button',{name:'Continue to signatures',exact:true}).first();
 const signB=pB.getByRole('button',{name:'Sign',exact:true});
 const entry=await waitFor(async()=>{
  if(await open.isVisible())return 'open';
  if(await reviewContinue.isVisible())return 'review';
  if(await signB.isVisible())return 'sign';
  return null;
 },35000);
 if(entry==='open'){
  await open.click();
  if(EMAIL_LIVE)await approvePrompt(b.context,/Sign message|Confirm Transaction/i).catch(()=>{});
 }
 if(EMAIL_LIVE){
  const coordinationState=await coordination(pA,new URL(shareUrl).hash.slice(1,17),new URL(shareUrl).hash.slice(17),a.address);
  const wasViewed=Boolean(coordinationState.coordination?.assignments?.find(x=>x.signerAddress===b.address)?.viewedAt);
  log('recipient_viewed',{recorded:wasViewed});
  if(!wasViewed)throw new Error('Recipient Viewed fact not recorded');
 }
 const next=await waitFor(async()=>await reviewContinue.isVisible()?'review':await signB.isVisible()?'sign':null,35000);
 if(next==='review'){await reviewContinue.click();log('mst_recipient_reviewed');}
 await signB.waitFor({state:'visible',timeout:35000});
 await signB.click();
 await approvePrompt(b.context,/Confirm Transaction/i);
 const ready=await waitFor(async()=>{
  const state=await coordination(pB,requestId,capability,b.address);
  return state.request?.signatureCount===2 && ['ready','submitted'].includes(state.request.status) ? state.request : null;
 },30000);
 if(ready.transactionHash!==first.transactionHash)throw new Error('Second signature changed the transaction hash');
 log('mst_recipient_signed',{signatureCount:ready.signatureCount,status:ready.status});
 if(ready.status==='ready'){
  const route=pB.getByRole('button',{name:/MultiSigTools submits/});
  const submit=pB.getByRole('button',{name:'Submit transaction',exact:true});
  const action=await waitFor(async()=>await submit.isVisible()?'submit':await route.isVisible()?'route':null,20000);
  if(action==='route')await route.click();
  await submit.waitFor({state:'visible',timeout:20000});
  await submit.click();
 }
 await pB.getByText('Transaction confirmed',{exact:true}).first().waitFor({state:'visible',timeout:35000});
 const recent=await horizon.transactions().forAccount(treasury.publicKey()).order('desc').limit(5).call();
 let found=null;
 for(const tx of recent.records){
   if(!tx.successful||tx.hash!==first.transactionHash)continue;
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
 }

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
