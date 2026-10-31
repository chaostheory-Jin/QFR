import { chromium } from '/Users/astonj/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const dir=fileURLToPath(new URL('.',import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH=dir+'browsers';
const dry=process.env.DRY_RUN==='1';
const kind=process.argv[2]||'payroll';
const english=process.env.VIDEO_LANGUAGE==='en';
const artifactName=kind+(english?'-en':'');
const englishCaptions={
 payroll:[
  'See gross pay, posted employer costs, settled payments and outstanding balances at a glance.',
  'Prioritize missing evidence and review exceptions. Approval, posting and payment remain separate.',
  'Missing overtime approval? Mark Needs changes and request evidence before approving.',
  'Filter the payroll register by employee and pay period, then open the individual payslip.',
  'Check gross pay, deductions, net pay and employer costs. Add a review note and save approval.',
  'Post an approved payslip to the demo ledger, linking payroll costs and liabilities to reports.',
  'Create a simulated settlement and bank evidence. No real money is transferred.',
  'Compare bank references, dates and amounts. The same amount alone does not confirm a match.',
  'Check the bank evidence, record your reasoning and confirm the payment-to-statement link.',
  'Inspect debit and credit entries, with an audit trail of review, posting, payment and bank checks.',
  'Export the audit record to preserve work stored in this browser-only demo.',
  'Overview → exception review → posting → simulated payment → bank review → audit export.'
 ],
 reconciliation:[
  'Compare invoices on the left with the master statement on the right, keeping evidence in view.',
  'This walkthrough uses the built-in sample animation and matching rules, not live AI or OCR.',
  'Locate the invoice number and final payable amount, preserving the original extracted values.',
  'Find candidates across all statement lines. Inspect a suggestion to highlight its source row.',
  'Equal amounts may belong to different invoices. A possible O / 0 error still requires review.',
  'Triage amount differences, ID issues, multiple candidates, missing matches and shared lines.',
  'Open the relevant review directly from the queue. Keep extraction and human decisions separate.',
  'Choose statement row 2 and inspect its location. Selecting a candidate does not change the ID.',
  'In this sample, correct the final O to 0 and document the decision. Keep the original extraction.',
  'Trace the original ID, manual correction and review history without silently replacing evidence.',
  'Return to all results. Confirmed items remain distinct from those still requiring manager review.',
  'Locate evidence → inspect candidates → triage exceptions → review decisions → retain audit history.'
 ]
};
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:1920,height:1080},deviceScaleFactor:1,...(dry?{}:{recordVideo:{dir:dir+'raw',size:{width:1920,height:1080}}})});
const page=await context.newPage();page.setDefaultTimeout(15000);
const chapters=[];let start=0;
const pause=ms=>page.waitForTimeout(dry?Math.min(ms,400):ms);
async function setup(){
 await page.addStyleTag({content:`.portal-shell{height:966px!important} #workspace-content main{max-width:1600px!important} nextjs-portal{display:none!important} #film-footer{position:fixed;bottom:0;left:0;right:0;height:114px;background:#263d49;color:#fff;z-index:2147483640;font-family:Arial,'PingFang SC',sans-serif;display:flex;align-items:center;padding:16px 52px;gap:28px;box-sizing:border-box;border-top:4px solid #a4b9ac} #film-step{font-size:32px;font-weight:700;color:#b9c9bd;border-right:1px solid #75868c;padding-right:28px} #film-title{font-size:21px;font-weight:600;margin-bottom:7px;letter-spacing:.4px} #film-copy{font-size:23px;color:#e4e9e7;line-height:1.4} #film-demo{margin-left:auto;font-size:13px;white-space:nowrap;letter-spacing:1px;color:#bac8c8;text-align:right;line-height:1.7} #film-pointer{position:fixed;width:24px;height:24px;border:3px solid #c28862;border-radius:50%;background:#d7a07a44;pointer-events:none;z-index:2147483645;transform:translate(-50%,-50%);transition:background .15s} #film-focus{position:fixed;border:3px solid #a98067;box-shadow:0 0 0 5px #c9a99122;border-radius:12px;pointer-events:none;z-index:2147483635;display:none}`});
 await page.evaluate(()=>{const f=document.createElement('div');f.id='film-footer';f.innerHTML='<div id="film-step"></div><div><div id="film-title"></div><div id="film-copy"></div></div><div id="film-demo">PRODUCT WALKTHROUGH<br>DEMO · FICTIONAL DATA</div>';document.body.append(f);const p=document.createElement('div');p.id='film-pointer';p.style.left='1870px';p.style.top='920px';document.body.append(p);const h=document.createElement('div');h.id='film-focus';document.body.append(h);document.addEventListener('mousemove',e=>{p.style.left=e.clientX+'px';p.style.top=e.clientY+'px'});document.addEventListener('mousedown',()=>p.style.background='#c28862');document.addEventListener('mouseup',()=>p.style.background='#d7a07a44');});
}
async function chapter(n,title,copy){if(english)copy=englishCaptions[kind][Number(n)-1];console.log(kind,n,title);chapters.push({n,title,copy,seconds:(Date.now()-start)/1000});await page.evaluate(({n,title,copy})=>{document.querySelector('#film-step').textContent=n;document.querySelector('#film-title').textContent=title;document.querySelector('#film-copy').textContent=copy},{n,title,copy});}
async function center(loc){await loc.waitFor({state:'visible'});await loc.evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest',behavior:'smooth'}));await pause(850);}
async function click(loc){await center(loc);const b=await loc.boundingBox();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:20});await pause(350);await loc.click();await pause(1000);}
const button=name=>page.getByRole('button',{name,exact:typeof name==='string'});
const tab=name=>page.getByRole('tab',{name,exact:typeof name==='string'});
async function fill(label,value){const l=page.getByLabel(label,{exact:true});await center(l);await l.fill(value);await pause(650);}
async function focus(loc){await center(loc);const b=await loc.boundingBox();await page.evaluate(b=>{const h=document.querySelector('#film-focus');Object.assign(h.style,{display:'block',left:(b.x-5)+'px',top:(b.y-5)+'px',width:(b.width+10)+'px',height:(b.height+10)+'px'})},b);await pause(3500);await page.evaluate(()=>document.querySelector('#film-focus').style.display='none');}
async function snap(name){await page.screenshot({path:dir+kind+'-'+name+'.png'});}
try{
 await page.goto('http://127.0.0.1:3000/'+(kind==='payroll'?'payroll':'reconciliation'));
 await (kind==='payroll'?tab('Overview'):button('Run sample animation')).waitFor();await page.waitForTimeout(1000);await setup();start=Date.now();
 if(kind==='payroll'){
  await chapter('01','PAYROLL · Financial overview','从工资总额、已入账成本，到员工实付与未付余额，一屏掌握。');await pause(6000);await focus(page.getByText('Monthly payroll',{exact:true}));await snap('overview');
  await chapter('02','Exception-led review','先处理缺失证据与低置信度事项；审核、入账、付款分别管理。');await click(tab(/Review queue/));await pause(4500);await click(button(/Jordan Lee · 2026-09/));await pause(2500);
  await chapter('03','Keep unresolved evidence visible','加班审批缺失时标记 Needs changes，不把待办当作已批准。');await fill('Payroll reviewer','Demo reviewer');await page.getByLabel('Payroll review decision',{exact:true}).selectOption('Needs changes');await fill('Payroll evidence note','Demo review: overtime approval is missing. Request the supporting timesheet before approval.');await click(button('Save 1 edited review'));await pause(2200);await snap('exception');
  await chapter('04','Find the employee and pay period','按员工与月份筛选逐行工资记录，进入独立的 payslip 明细。');await click(button('Back to register'));await click(page.locator('summary').filter({hasText:'Filters ·'}));await fill('Payroll from','2026-09-01');await fill('Search payroll','Alex Morgan');await click(page.locator('summary').filter({hasText:'Filters ·'}));await click(button('View payslip MOCK-2026-09-EMP-001'));await pause(3500);
  await chapter('05','Payslip breakdown & saved approval','查看税前、扣缴、实付和雇主成本；填写审核意见后保存批准。');await focus(page.getByText('Mock payslip · Alex Morgan',{exact:true}));await fill('Payroll evidence note','Sample walkthrough: approve this fictional payslip after checking the displayed pay breakdown. No real payroll authorization.');await click(button('Save 1 edited review'));await pause(2200);await snap('approved');
  await chapter('06','Post to the demo ledger','批准后才可入账；入账后的工资成本与负债联动到演示财务报表。');await click(button('Post to demo ledger'));await pause(3500);
  await chapter('07','Simulated settlement','再模拟员工付款，生成结算与银行证据；不会触发真实转账。');await click(button('Simulate remaining payment'));await pause(3500);await click(button('View payments & bank evidence'));await pause(1800);
  await chapter('08','Locate bank evidence','从银行流水候选中检查日期、编号和金额；金额相同不等于已确认。');await click(button(/Inspect bank candidate 1 for/).first());await pause(3500);await snap('bank-candidate');
  await chapter('09','Human-confirmed bank match','核对原始流水并留下说明，再确认付款与银行流水的对应关系。');await fill((await page.locator('textarea[aria-label^="Bank review note"]').first().getAttribute('aria-label')),'Demo review: checked the sample payment reference, pay date and equal cash outflow against the selected bank line.');await click(button('Confirm bank match'));await pause(3500);
  await chapter('10','Journal & audit trail','逐笔查看借贷分录，并保留审核、入账、付款和银行匹配的操作记录。');await click(tab('Journals & audit'));await focus(page.getByText('Linked journal entries',{exact:true}));await click(page.locator('summary').filter({hasText:'Browser audit history'}));await pause(3500);await snap('audit');
  await chapter('11','Exportable review evidence','导出审核记录，保留浏览器内的演示工作成果。');const download=page.waitForEvent('download');await click(button('Export audit'));await download;await pause(2000);
  await chapter('12','PAYROLL · End-to-end demo','总览 → 异常审核 → 入账 → 模拟付款 → 银行核对 → 审计导出。');await click(tab('Overview'));await page.locator('#workspace-content').evaluate(e=>e.scrollTo({top:0,behavior:'smooth'}));await pause(6000);await snap('end');
 }else{
  await chapter('01','COLA RECONCILIATION · Evidence first','左侧 Invoice，右侧 Statement；原始单据与匹配结果放在一起核对。');await pause(5000);await focus(page.getByText('Upload invoice documents',{exact:true}));await focus(page.getByText('Upload master statement',{exact:true}));await snap('uploads');
  await chapter('02','Run the built-in sample','以下使用内置样例动画与匹配逻辑演示，不发起实时 AI / OCR 请求。');await click(button('Run sample animation'));await page.getByText('Reconciliation complete',{exact:true}).waitFor();await pause(2500);
  await chapter('03','Invoice ID & final payable amount','定位发票编号与最终应付金额，保留原始提取值，便于并排核对。');await click(button('Invoice 2'));await focus(page.getByText('Gross Amount Payable',{exact:true}).first());await pause(3000);await snap('evidence');
  await chapter('04','Search every statement line','在全部流水里寻找候选；点击建议后，自动定位并高亮原始目标行。');await click(button('Inspect candidate 1, statement row 2'));await focus(page.locator('[data-statement-index="1"]'));await pause(2500);await snap('target-line');
  await chapter('05','Suggestions are not approvals','相同金额可能对应多张发票；疑似 O / 0 识别错误仍需人工确认。');await focus(page.getByRole('region',{name:'Active invoice review candidates'}));await pause(2500);
  await chapter('06','Exception queues','按金额差异、编号疑点、多候选、缺失记录与重复引用分组进入待办。');await click(tab(/2\. Match results/));await focus(page.getByRole('region',{name:'Reconciliation exception queues'}));await click(button(/Possible ID issue/));await pause(3000);await snap('queues');
  await chapter('07','Open the invoice review','从对应待办直接进入审核，保留系统提取与人工决定两套记录。');await click(button('Open this review').first());await fill('Reconciliation reviewer','Demo reviewer');await pause(2000);
  await chapter('08','Choose a candidate, then confirm','先选择主表第 2 行，查看定位；候选选择不会自动改写发票字段。');await page.getByLabel('Statement candidate 1',{exact:true}).selectOption('1');await pause(3000);await click(tab(/3\. Human review/));
  await chapter('09','A documented manual decision','示例中人工将末位 O 校正为 0，并记录原因；原始提取值仍保留。');await fill('Confirmed invoice 1','I1000064240');await fill('Review reason 1','Illustrative sample decision: confirm statement row 2 and correct the final character O to 0 for this demo. Amount unchanged; original extraction retained.');await pause(1800);await click(page.locator('[data-review-invoice="1"]').getByRole('button',{name:'Save review',exact:true}));await pause(3000);await snap('review-saved');
  await chapter('10','Preserve the original & review history','保存后仍能追溯原始编号、人工修订与审核记录，不静默覆盖证据。');await click(page.locator('[data-review-invoice="1"]').locator('summary').filter({hasText:'Immutable extraction and review history'}));await pause(4000);await snap('history');
  await chapter('11','Updated outcomes, visible remaining work','回到全部结果，已审核与仍待经理确认的项目分开显示。');await click(tab(/2\. Match results/));await click(button(/All results ·/));await focus(page.locator('#reconciliation-result-list'));await pause(3500);await snap('outcomes');
  await chapter('12','COLA · Traceable reconciliation','证据定位 → 全量流水候选 → 异常分流 → 人工复核 → 保留审计记录。');await click(tab(/1\. Documents/));await click(button('Invoice 2'));await focus(page.getByText('Gross Amount Payable',{exact:true}).first());await pause(4500);await snap('end');
 }
 await fs.writeFile(dir+artifactName+'-chapters.json',JSON.stringify(chapters,null,2));
 console.log('DONE',kind,'seconds',(Date.now()-start)/1000);
 if(!dry){const video=page.video();await context.close();console.log('VIDEO',await video.path());await fs.writeFile(dir+artifactName+'-video.json',JSON.stringify({path:await video.path(),chapters}));}else await context.close();
}catch(e){console.error(e.message);await page.screenshot({path:dir+kind+'-error.png'});await fs.writeFile(dir+kind+'-error.txt',await page.locator('body').innerText());await context.close();process.exitCode=1;}
await browser.close();
