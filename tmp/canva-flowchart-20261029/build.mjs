import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Presentation,PresentationFile} from '@oai/artifact-tool';
const build=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(build,'../..');
const skill='/Users/astonj/.codex/plugins/cache/openai-primary-runtime/presentations/26.1025.11240/skills/presentations';
const py='/Users/astonj/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const W=1600,H=2240;
const p=Presentation.create({slideSize:{width:W,height:H}});
const C={bg:'#FAF9F6',ink:'#35413E',muted:'#68716B',line:'#92988F',sand:'#E7DFD1',blue:'#DBE3E7',sage:'#D8E1D4',rose:'#E8D8D3',lavender:'#DED9E6'};
const nodes=[
 ['internal',40,120,320,140,'sand','内部资料','管理报表、流程图、制度\n业务说明','Internal records','Reports, policies and\nprocess maps\nBusiness descriptions'],
 ['transactions',400,120,340,140,'sand','交易资料','银行流水、转账记录\n发票与合同','Transaction records','Bank statements and transfers,\ninvoices and contracts'],
 ['people',780,120,320,140,'sand','人员资料','员工、部门、岗位\n工资单','People records','Employees, departments, roles\nand payslips'],
 ['updates',1170,120,350,140,'lavender','新资料持续进入','增量更新，重查受影响项目\n保留已发布版本','Ongoing updates','Refresh affected records\nand retain published versions'],
 ['intake',450,330,480,145,'blue','1 统一接入与证据归档','授权读取、上传或系统连接\n保留原件、来源、版本及访问权限','1 Intake and evidence archive','Authorized access, uploads or connectors\nKeep originals, sources, versions\nand access permissions'],
 ['extract',450,520,480,145,'blue','2 AI 识别与理解','OCR、表格与文档解析\n提取主体、金额、日期及业务关系','2 AI extraction and understanding','OCR, table and document parsing\nExtract entities, amounts, dates\nand business relationships'],
 ['normalize',450,710,480,145,'blue','3 数据清洗与身份关联','去重、统一格式、区分币种\n关联同一员工、客户、供应商和账户','3 Cleaning and identity resolution','Deduplicate, standardize and retain currencies\nLink records for the same employees,\ncustomers, suppliers and accounts'],
 ['facts',450,900,480,145,'sage','4 公司事实与事件模型','谁属于谁，谁向谁付款\n识别对应的业务与事件\n每条事实关联原始证据与可信度','4 Company facts and event model','Who belongs to whom, who pays whom,\nand which business activity is involved\nLink each fact to evidence and confidence'],
 ['links',650,1110,430,145,'blue','交易证据关联','合同、发票、付款与银行流水\n员工、工资批次、工资单与付款\n按业务关系关联原始证据','Transaction evidence links','Link contracts, invoices, payments\nand bank records\nLink staff, payroll batches and payslips'],
 ['settings',1140,1110,360,145,'sand','基础配置与余额','主体范围、报表期间、币种\n会计政策、科目表、期初余额','Scope and balances','Entities, period and currencies\nPolicies and chart of accounts\nOpening balances'],
 ['org',80,1320,430,145,'sage','公司结构草稿','法人关系、部门与岗位、汇报关系\n业务流程、职责与审批关系','Draft company structure','Legal entities, departments, roles\nand reporting lines\nProcesses, responsibilities and approvals'],
 ['ledger',650,1320,430,145,'blue','5 生成账务草稿','科目分类、业务期间、应收应付\n工资分录、总账与明细账','5 Draft accounting records','Classify accounts and accounting periods\nBuild receivables, payables, payroll\nand general and subsidiary ledgers'],
 ['checks',330,1530,500,150,'rose','6 证据与一致性检查','资料是否完整？金额是否一致？\n是否存在关系冲突或重复记录？','6 Evidence and consistency checks','Is the evidence complete? Do amounts agree?\nCheck conflicting relationships\nand duplicate records'],
 ['publish',220,1760,480,155,'lavender','7 授权确认与版本发布','区分原始事实、AI 推断和人工确认\n保留审批记录与证据链','7 Authorized approval and release','Distinguish source facts, AI inferences\nand human confirmations\nRetain approvals and the evidence trail'],
 ['review',990,1760,480,155,'rose','异常处理与人工审核','补资料、修正识别、确认归属\n由财务或业务负责人审核','Exceptions and human review','Request evidence, correct extraction\nand confirm ownership\nFinance or business owners review'],
 ['structure',40,2040,460,150,'sage','公司结构与流程','组织架构图、法人关系图\n业务流程图、职责与审批图','Company structure and processes','Organisation and legal entity charts\nBusiness process maps\nResponsibilities and approval paths'],
 ['reports',560,2040,480,150,'sage','财务报表','利润表、资产负债表、现金流量表\n逐层追溯到明细与原始凭证','Financial statements','Profit and loss, balance sheet,\nand cash flow\nTrace to records and original evidence'],
 ['operations',1100,2040,460,150,'sage','经营与人员报表','应收应付账龄、部门成本\n工资报表、付款清单、异常清单','Operating and people reports','Receivables and payables ageing\nDepartment costs, payroll reports\nPayment lists and exception queues'],
];
function text(slide,name,txt,x,y,w,h,size,bold,font,align='center',fill='none'){
 const s=slide.shapes.add({geometry:'textbox',name,position:{left:x,top:y,width:w,height:h},fill,line:{fill:'none',width:0}});
 s.text=txt;s.text.style={typeface:font,fontSize:size,bold,color:C.ink,alignment:align,verticalAlignment:'middle',autoFit:'none',wrap:'none',insets:0};return s;
}
function segment(slide,name,x1,y1,x2,y2,arrow=false,dashed=false){
 const s=slide.shapes.add({geometry:'connector',kind:'straight',name,position:{left:Math.min(x1,x2),top:Math.min(y1,y2),width:Math.abs(x2-x1),height:Math.abs(y2-y1),horizontalFlip:x2<x1,verticalFlip:y2<y1},line:{fill:C.line,width:2.2,style:dashed?'dashed':'solid'},tail:arrow?{type:'triangle',width:'med',length:'med'}:{type:'none'}});s.sendToBack();return s;
}
function route(slide,name,pts,dashed=false){for(let k=0;k<pts.length-1;k++)segment(slide,name+'-'+k,...pts[k],...pts[k+1],k===pts.length-2,dashed);}
for(const lang of ['zh','en']){
 const slide=p.slides.add();slide.background.fill=C.bg;
 const font=lang==='zh'?'Heiti SC':'Arial';const isZh=lang==='zh';const shapes={};
 text(slide,'diagram-title',isZh?'公司数据整合与报表生成流程':'Company data integration and reporting',40,34,1520,62,42,true,font);
 for(const [id,x,y,w,h,color,zhTitle,zhBody,enTitle,enBody] of nodes){
  const s=slide.shapes.add({geometry:'roundRect',name:id,position:{left:x,top:y,width:w,height:h},fill:C[color],line:{fill:C.line,width:1.5},borderRadius:22});shapes[id]=s;
  text(slide,id+'-title',isZh?zhTitle:enTitle,x+12,y+12,w-24,36,isZh?27:25,true,font);
  text(slide,id+'-body',isZh?zhBody:enBody,x+14,y+51,w-28,h-62,isZh?25:22,false,font);
 }
 // Orthogonal native connectors preserve the source graph without crossing text.
 route(slide,'internal-intake',[[200,260],[200,295],[570,295],[570,330]]);
 route(slide,'transactions-intake',[[570,260],[690,260],[690,330]]);
 route(slide,'people-intake',[[940,260],[940,295],[810,295],[810,330]]);
 route(slide,'updates-intake',[[1345,260],[1345,305],[900,305],[900,330]],true);
 for(const [a,b] of [['intake','extract'],['extract','normalize'],['normalize','facts']]){
  slide.shapes.connect(shapes[a],shapes[b],{kind:'straight',fromSide:'bottom',toSide:'top',line:{fill:C.line,width:2.2},tail:{type:'triangle',width:'med',length:'med'}});
 }
 route(slide,'facts-org',[[450,972],[295,972],[295,1320]]);
 route(slide,'facts-links',[[690,1045],[690,1080],[865,1080],[865,1110]]);
 route(slide,'links-ledger',[[865,1255],[865,1320]]);
 route(slide,'settings-ledger',[[1320,1255],[1320,1290],[1000,1290],[1000,1320]]);
 route(slide,'org-checks',[[295,1465],[295,1500],[450,1500],[450,1530]]);
 route(slide,'ledger-checks',[[865,1465],[865,1500],[710,1500],[710,1530]]);
 route(slide,'checks-publish',[[460,1680],[460,1760]]);
 route(slide,'checks-review',[[830,1605],[1230,1605],[1230,1760]]);
 text(slide,'pass-label',isZh?'检查通过':'Checks passed',325,1697,270,38,23,true,font,'center',C.bg);
 text(slide,'review-label',isZh?'缺失、冲突或低置信度':'Missing, conflicting or uncertain',1000,1697,470,38,23,true,font,'center',C.bg);
 route(slide,'review-facts',[[1470,1837],[1550,1837],[1550,972],[930,972]],true);
 text(slide,'correction-label',isZh?'补充证据与确认修正':'Additional evidence and confirmed corrections',960,925,580,38,21,true,font,'center',C.bg);
 route(slide,'publish-structure',[[340,1915],[340,1990],[270,1990],[270,2040]]);
 route(slide,'publish-reports',[[460,1915],[460,1960],[800,1960],[800,2040]]);
 route(slide,'publish-operations',[[580,1915],[580,1935],[1330,1935],[1330,2040]]);
 slide.speakerNotes.text=isZh?'概念流程。自动处理依赖授权访问、证据质量和必要的人工确认，不能保证在证据缺失时生成完整且正确的报表。':'Conceptual workflow. Automation depends on authorized access, evidence quality and required human approval. Missing evidence can prevent complete and correct reporting.';
 const png=await p.export({slide,format:'png',scale:.8});await fs.writeFile(path.join(build,lang+'.png'),new Uint8Array(await png.arrayBuffer()));
 const layout=await slide.export({format:'layout'});await fs.writeFile(path.join(build,lang+'.layout.json'),await layout.text());
}
const candidate=path.join(build,'candidate.pptx');await(await PresentationFile.exportPptx(p)).save(candidate);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')).href);
const output=path.join(root,'outputs/canva-flowchart-20261029/company-data-workflow-cn-en.pptx');
// The runtime's PPTX re-import crashes in WASM. Use package/layout validation here,
// then independently reopen and render the exact exported file with LibreOffice.
const r=await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath:output,pythonExecutable:py,integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu',`${W*9525},${H*9525}`,'--validate-heading-fit'],explicitTotalSlideCount:2,requiredNativeTableOwnerSlides:[],requiredNativeChartOwnerSlides:[],fontPolicy:{basis:'design',families:['Arial','Heiti SC']},verifyArtifactToolImport:false,receiptPath:path.join(build,'validation.json')});
console.log(JSON.stringify(r));
