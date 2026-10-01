# 上传测试数据（完全合成）

本目录提供 **21 个 CSV + 2 个 Excel，共 22,424 行**。其中包含故意无效的数据；12,391 行在各自推荐设置下单独校验没有阻断错误（其中 5 行会提示分类审核）。没有读取或复制任何客户数据，也不调用 OpenAI。

这些是上传、校验、批次隔离和原始行追溯的测试记录，不是完整的复式记账总账，也不是 OCR 发票图片。不要用它们验证真实公司的财务结论。

## 从哪里开始

在前端 **Data connections → 文件上传 → File import and data checks**（`/imports`）选择本目录中的文件。

推荐先上传 `01_valid_ledger_100.csv`，设置：

- Company / entity：`SYNTHETIC Upload QA`
- Source system：`Synthetic Upload QA v1`
- Currency：`AUD`（USD 文件必须改成 USD）
- Document kind：`Ledger`（发票文件选 Invoice detail，银行文件选 Bank transactions）
- 上传后 Date convention 默认 `ISO`；Duplicate rows 默认 `Block for review`
- 点击 **Validate mapping**，正常文件应没有错误，再点击 **Commit validated batch**。

CSV 使用 **UTF-8 BOM**，兼容当前读取器及 Excel 的中文/重音文本识别。所有列都在第一行，金额为原始数值，没有美化标题或汇总行混入数据。

手动上传当前不会自动设置 API 的 `sample` 标记，因此请保留 `SYNTHETIC` 公司名和文件名，避免混同真实批次。已有的页面内置 mock 按钮仍可使用，其样本只有 2 行正常记录/4 行异常记录。

## 文件清单与预期结果

| 文件 | 数据行 | 预期及设置 |
| --- | ---: | --- |
| `01_valid_ledger_100.csv` | 100 | 最小入门，正常通过 |
| `02_valid_ledger_1000.csv` | 1,000 | 常规数据量，正常通过 |
| `03_valid_ledger_10000.csv` | 10,000 | 当前行数上限，正常通过；约 1.46 MB |
| `04_valid_invoices_150.csv` | 150 | AUD，选择 Invoice detail |
| `05_valid_bank_300.csv` | 300 | AUD，选择 Bank transactions |
| `06_valid_usd_200.csv` | 200 | 批次币种选择 USD |
| `07_valid_dates_dmy_30.csv` | 30 | 日期选择 DMY；默认 ISO 会报 30 个日期错误 |
| `07_valid_dates_mdy_30.csv` | 30 | 日期选择 MDY；默认 ISO 会报 30 个日期错误 |
| `08_manual_column_mapping_30.csv` | 30 | 中文列名，按下表手工映射后通过 |
| `09_valid_edge_cases_6.csv` | 6 | 零、负数、带千分位金额、引号/换行/中文、前导零 ID、闰日和年末均应保留 |
| `10_invalid_fields_12.csv` | 12 | 阻止提交：12 个错误，覆盖日期、金额、必填值、税额和非法行类型 |
| `11_invalid_currencies_4.csv` | 4 | 阻止提交：3 个币种错误、2 个金额精度错误、2 个税额错误 |
| `12_duplicate_rows_3.csv` | 3 | 默认 1 个重复错误；改 Exclude 后保留 2 行、1 个警告，原始重复行仍归档 |
| `13_duplicates_without_ids_3.csv` | 3 | 默认阻止；改 Keep 后 3 行保留、1 个警告 |
| `14_conflicting_ids_3.csv` | 3 | 同一 ID 的金额不同；Block/Exclude 均阻止，不能靠去重隐藏冲突 |
| `15_category_review_5.csv` | 5 | 0 错误、5 个分类警告；归为 Unmapped，role 为 unknown |
| `16_cross_batch_a_20.csv` | 20 | 先提交 A，再测试 B |
| `17_cross_batch_b_20.csv` | 20 | 单独校验通过；同公司/来源/币种/类型下提交 A 后，B 的 5 个 ID 被阻止 |
| `18_invalid_row_limit_10001.csv` | 10,001 | 文件小于 3 MB，但超过行数上限，应在读取时拒绝 |
| `19_invalid_duplicate_headers.csv` | 1 | 第一行重复列名，应拒绝读取 |
| `20_invalid_missing_header.csv` | 1 | 第一行空列名，应拒绝读取 |
| `outputs/upload-qa-v1/21_valid_multi_sheet.xlsx` | 500 | Ledger 250 行、Invoices 100 行、Bank 150 行；真实 Excel 日期及数值类型，分别选择对应工作表/文档类型 |
| `outputs/upload-qa-v1/22_invalid_formula_amount.xlsx` | 5 | B2 是 Excel 公式；即使缓存结果为 100，仍应拒绝该金额 |

文档类型属于批次元数据，切换工作表不会自动更改它；要导入多工作表 Excel 中的发票或银行表，须在上传前选对类型，然后选对应工作表重新校验。它们不自动合并进现有 Xero/QuickBooks P&L/Balance Sheet，不重复计入收入。

各正常文件的行 ID 使用独立前缀；只有 A/B 专门重复 5 个 ID。相同文件用相同批次元数据再次上传，会返回已有批次，而不是重新入账。需要重跑交互测试时可更换合成公司名；测试 A/B 时必须保持两次元数据完全一致。

### 中文列名映射

| 字段 | 选择的列名 | 字段 | 选择的列名 |
| --- | --- | --- | --- |
| date | 记账日期 | recordId | 原始行号 |
| amount | 金额 | invoice | 发票号 |
| currency | 币种 | contact | 往来方 |
| account | 科目 | category | 分类 |
| description | 摘要 | role | 行类型 |
| tax | 税额 | department | 部门 |

## 原文件、预期结果和自动测试在哪里

- 本目录保存可直接上传的 CSV；Excel 位于 `outputs/upload-qa-v1/`。
- `manifest.json` 记录每个文件 SHA-256、字节数、批次元数据、行数、日期/去重设置、错误和警告数量、正常数据的分类金额控制总数。
- 上传后服务器在 `output/data-platform/imports/<batch-id>/` 保存 `original.bin`（完整原始字节）及 `snapshot.json`（来源、映射、检查结果和规范化记录）；不覆盖原始测试文件。
- `frontend/src/lib/upload-fixtures.test.ts` 逐个读取交付文件，调用当前真实上传校验器，检查预期结果、哈希、金额合计、中文/换行/前导零、重复策略，以及 A/B 持久化提交冲突。

```bash
cd frontend
npm test -- src/lib/upload-fixtures.test.ts
```

## 再生成更多数据

生成器是 `scripts/generate-upload-fixtures.mjs`，记录内容由固定算法生成，正常文件互不共用 ID。修改 `rows(prefix, count, currency, kind)` 的调用可增加规模或新增场景；单文件目前限 10,000 行和 3 MB，超限只适合负向测试。Excel 打包元数据可能随重新导出变化，清单哈希会同步更新。

生成器依赖 `@oai/artifact-tool`，运行环境需要已有该库；不向项目安装新依赖。Codex 使用自带运行时。手动运行的通用命令：

```bash
# 在能解析 @oai/artifact-tool 的 Node 环境中，从项目根目录执行
node scripts/generate-upload-fixtures.mjs test-data/uploads
```

重复运行会重新生成本目录中的同名合成文件及清单；不会更改现有报表、客户数据或已上传批次。
