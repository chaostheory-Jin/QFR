export type RawRow = {
  Type: string
  InvoiceNumber: string
  Date: string
  Contact: string
  AccountCode: string
  AccountName: string
  Description: string
  Amount: number
  MappedCategory: string
  Confidence: number
  Reason: string
  RuleID: string | null
  OriginalMappedCategory: string
  NormalizationRule: string | null
  Budget?: number
  LineID?: string
  LineRole?: 'income' | 'other_income' | 'expense' | 'other_expense' | 'cost_of_goods_sold' | 'unknown'
  ReviewRequired?: boolean
  ReviewReason?: string
  AutoAcceptedCategory?: string
  ProposedCategory?: string
  ReviewStatus?: 'Pending' | 'Approved' | 'Needs changes' | 'Rejected'
  ReviewerNote?: string
  ReviewedAt?: string
}

export type BalanceSheetRow = {
  Type: string
  InvoiceNumber: string | number
  Date: string
  Contact: string
  AccountCode: string
  AccountName: string
  Description: string
  Amount: number
  BalanceSheetSection: string
  BalanceSheetSectionPath: string
  BalanceSheetCategory: string
  BalanceSheetAccountName: string
  BalanceSheetMappingSource: string
  BalanceSheetReason: string
  BalanceSheetSyntheticKind: string | null
  SourceDocumentID: string | null
  Status: string | null
  PaymentID: string | null
  JournalSourceType: string | null
  JournalID: string | null
}

export type BalanceSheetSummaryRow = {
  BalanceSheetSection: string
  BalanceSheetSectionPath: string
  BalanceSheetCategory: string
  AccountCode: string
  BalanceSheetAccountName: string
  Amount: number
}

export type ReportData = {
  meta: { report_from: string; report_to: string; balance_sheet_date: string }
  raw_data: RawRow[]
  balance_sheet_data: BalanceSheetRow[]
  balance_sheet_summary: BalanceSheetSummaryRow[]
  income_categories: string[]
  allowed_categories: string[]
  review_threshold: number
}

export const REPORT_DATA: ReportData = {
  meta: { report_from: '2025-01-01', report_to: '2025-12-31', balance_sheet_date: '2026-05-13' },
  raw_data: [
    { Type: 'Bill', InvoiceNumber: '07c863d4-f3c8-49c7-ae40-3e844afe0202', Date: '2025-01-21', Contact: 'DIISR - Small Business Services', AccountCode: '412', AccountName: 'Consulting & Accounting', Description: 'Half day training - Microsoft Office', Amount: 1800.0, MappedCategory: 'Consulting & Accounting', Confidence: 0.99, Reason: 'Training keyword policy: map Microsoft Office half-day training to Consulting & Accounting', RuleID: 'PATCH_CONSULTING_TRAINING_MICROSOFT_OFFICE', OriginalMappedCategory: 'Consulting & Accounting', NormalizationRule: null },
    { Type: 'Bill', InvoiceNumber: '07c863d4-f3c8-49c7-ae40-3e844afe0202', Date: '2025-01-21', Contact: 'DIISR - Small Business Services', AccountCode: '453', AccountName: 'Office Expenses', Description: 'Desktop/network support via email & phone. Per month fixed fee for minimum 20 hours/month.', Amount: 4000.0, MappedCategory: 'Office Expenses', Confidence: 0.99, Reason: 'Account-code guard: 453 is mapped to Office Expenses', RuleID: 'PATCH_ACCOUNT_453_OFFICE_EXPENSES', OriginalMappedCategory: 'Office Expenses', NormalizationRule: null },
    { Type: 'Bill', InvoiceNumber: '07c863d4-f3c8-49c7-ae40-3e844afe0202', Date: '2025-01-21', Contact: 'DIISR - Small Business Services', AccountCode: '461', AccountName: 'Printing & Stationery', Description: 'Stationery charges', Amount: 256.0, MappedCategory: 'Printing & Stationery', Confidence: 0.9, Reason: "The description 'Stationery charges' directly relates to office supplies.", RuleID: null, OriginalMappedCategory: 'Printing & Stationery', NormalizationRule: null },
    { Type: 'Bill', InvoiceNumber: '827df103-9a98-4f05-a091-665ac39d489e', Date: '2025-03-24', Contact: 'DIISR - Small Business Services', AccountCode: '412', AccountName: 'Consulting & Accounting', Description: 'Half day training - Microsoft Office', Amount: 1800.0, MappedCategory: 'Consulting & Accounting', Confidence: 0.99, Reason: 'Training keyword policy', RuleID: 'PATCH_CONSULTING_TRAINING_MICROSOFT_OFFICE', OriginalMappedCategory: 'Consulting & Accounting', NormalizationRule: null },
    { Type: 'Bill', InvoiceNumber: '827df103-9a98-4f05-a091-665ac39d489e', Date: '2025-03-24', Contact: 'DIISR - Small Business Services', AccountCode: '453', AccountName: 'Office Expenses', Description: 'Desktop/network support via email & phone.\r\nPer month fixed fee for minimum 20 hours/month.', Amount: 4000.0, MappedCategory: 'Office Expenses', Confidence: 0.99, Reason: 'Account-code guard: 453 is mapped to Office Expenses', RuleID: 'PATCH_ACCOUNT_453_OFFICE_EXPENSES', OriginalMappedCategory: 'Office Expenses', NormalizationRule: null },
    { Type: 'Bill', InvoiceNumber: '827df103-9a98-4f05-a091-665ac39d489e', Date: '2025-03-24', Contact: 'DIISR - Small Business Services', AccountCode: '461', AccountName: 'Printing & Stationery', Description: 'Stationery charges', Amount: 256.0, MappedCategory: 'Printing & Stationery', Confidence: 0.9, Reason: "The description 'Stationery charges' directly relates to office supplies.", RuleID: null, OriginalMappedCategory: 'Printing & Stationery', NormalizationRule: null },
    { Type: 'Invoice', InvoiceNumber: 'ORC0999', Date: '2025-02-21', Contact: 'Maddox Publishing Group', AccountCode: '200', AccountName: 'Sales', Description: 'Project Management - onsite daily rate', Amount: 4200.0, MappedCategory: 'Sales', Confidence: 0.95, Reason: 'The description indicates revenue from project management services.', RuleID: null, OriginalMappedCategory: 'Sales', NormalizationRule: null },
  ],
  balance_sheet_data: [
    { Type: 'Journal-ACCPAYPAYMENT', InvoiceNumber: 347, Date: '2025-02-21', Contact: 'Journal', AccountCode: '800', AccountName: 'Accounts Payable', Description: 'Journal 347', Amount: 6661.6, JournalSourceType: 'ACCPAYPAYMENT', JournalID: '68b86ed5-6e1a-496e-8389-9adb8e6b1ab8', BalanceSheetSection: 'Current Liabilities', BalanceSheetSectionPath: 'Current Liabilities', BalanceSheetCategory: 'Accounts Payable', BalanceSheetAccountName: 'Accounts Payable', BalanceSheetMappingSource: 'xero_balance_sheet', BalanceSheetReason: 'Mapped from Xero Balance Sheet structure', BalanceSheetSyntheticKind: null, SourceDocumentID: null, Status: null, PaymentID: null },
    { Type: 'Journal-ACCPAYPAYMENT', InvoiceNumber: 347, Date: '2025-02-21', Contact: 'Journal', AccountCode: '090', AccountName: 'Business Bank Account', Description: 'Journal 347', Amount: -6661.6, JournalSourceType: 'ACCPAYPAYMENT', JournalID: '68b86ed5-6e1a-496e-8389-9adb8e6b1ab8', BalanceSheetSection: 'Bank', BalanceSheetSectionPath: 'Bank', BalanceSheetCategory: 'Business Bank Account', BalanceSheetAccountName: 'Business Bank Account', BalanceSheetMappingSource: 'xero_balance_sheet', BalanceSheetReason: 'Mapped from Xero Balance Sheet structure', BalanceSheetSyntheticKind: null, SourceDocumentID: null, Status: null, PaymentID: null },
    { Type: 'Bill-Control', InvoiceNumber: '07c863d4-f3c8-49c7-ae40-3e844afe0202', Date: '2025-01-21', Contact: 'DIISR - Small Business Services', AccountCode: '800', AccountName: 'Accounts Payable', Description: 'Bill gross balance', Amount: 6661.6, JournalSourceType: null, JournalID: null, BalanceSheetSection: 'Current Liabilities', BalanceSheetSectionPath: 'Current Liabilities', BalanceSheetCategory: 'Accounts Payable', BalanceSheetAccountName: 'Accounts Payable', BalanceSheetMappingSource: 'xero_balance_sheet', BalanceSheetReason: 'Mapped from Xero Balance Sheet structure', BalanceSheetSyntheticKind: 'InvoiceGross', SourceDocumentID: '07c863d4-f3c8-49c7-ae40-3e844afe0202', Status: 'PAID', PaymentID: null },
    { Type: 'Bill-Payment', InvoiceNumber: '07c863d4-f3c8-49c7-ae40-3e844afe0202', Date: '2025-02-21', Contact: 'DIISR - Small Business Services', AccountCode: '800', AccountName: 'Accounts Payable', Description: 'Bill payment allocation', Amount: -6661.6, JournalSourceType: null, JournalID: null, BalanceSheetSection: 'Current Liabilities', BalanceSheetSectionPath: 'Current Liabilities', BalanceSheetCategory: 'Accounts Payable', BalanceSheetAccountName: 'Accounts Payable', BalanceSheetMappingSource: 'xero_balance_sheet', BalanceSheetReason: 'Mapped from Xero Balance Sheet structure', BalanceSheetSyntheticKind: 'Payment', SourceDocumentID: '07c863d4-f3c8-49c7-ae40-3e844afe0202', Status: 'PAID', PaymentID: '0be870d6-55fe-4a57-ab6a-6926625068b2' },
    { Type: 'Bill-GST', InvoiceNumber: '07c863d4-f3c8-49c7-ae40-3e844afe0202', Date: '2025-01-21', Contact: 'DIISR - Small Business Services', AccountCode: '820', AccountName: 'GST', Description: 'GST on Half day training - Microsoft Office', Amount: -180.0, JournalSourceType: null, JournalID: null, BalanceSheetSection: 'Current Liabilities', BalanceSheetSectionPath: 'Current Liabilities', BalanceSheetCategory: 'GST', BalanceSheetAccountName: 'GST', BalanceSheetMappingSource: 'xero_balance_sheet', BalanceSheetReason: 'Mapped from Xero Balance Sheet structure', BalanceSheetSyntheticKind: 'GST', SourceDocumentID: null, Status: null, PaymentID: null },
    { Type: 'Invoice-Control', InvoiceNumber: 'ORC0999', Date: '2025-02-21', Contact: 'Maddox Publishing Group', AccountCode: '610', AccountName: 'Accounts Receivable', Description: 'Invoice gross balance', Amount: 4620.0, JournalSourceType: null, JournalID: null, BalanceSheetSection: 'Current Assets', BalanceSheetSectionPath: 'Current Assets', BalanceSheetCategory: 'Accounts Receivable', BalanceSheetAccountName: 'Accounts Receivable', BalanceSheetMappingSource: 'xero_balance_sheet', BalanceSheetReason: 'Mapped from Xero Balance Sheet structure', BalanceSheetSyntheticKind: 'InvoiceGross', SourceDocumentID: '55181e42-eb6f-4cd2-bd0a-58083983c3c6', Status: 'PAID', PaymentID: null },
    { Type: 'Invoice-Payment', InvoiceNumber: 'ORC0999', Date: '2025-04-23', Contact: 'Maddox Publishing Group', AccountCode: '610', AccountName: 'Accounts Receivable', Description: 'Invoice payment allocation', Amount: -4620.0, JournalSourceType: null, JournalID: null, BalanceSheetSection: 'Current Assets', BalanceSheetSectionPath: 'Current Assets', BalanceSheetCategory: 'Accounts Receivable', BalanceSheetAccountName: 'Accounts Receivable', BalanceSheetMappingSource: 'xero_balance_sheet', BalanceSheetReason: 'Mapped from Xero Balance Sheet structure', BalanceSheetSyntheticKind: 'Payment', SourceDocumentID: '55181e42-eb6f-4cd2-bd0a-58083983c3c6', Status: 'PAID', PaymentID: 'a9b17229-7e6a-492f-834d-617de2d20bb4' },
    { Type: 'Invoice-GST', InvoiceNumber: 'ORC0999', Date: '2025-02-21', Contact: 'Maddox Publishing Group', AccountCode: '820', AccountName: 'GST', Description: 'GST on Project Management - onsite daily rate', Amount: 420.0, JournalSourceType: null, JournalID: null, BalanceSheetSection: 'Current Liabilities', BalanceSheetSectionPath: 'Current Liabilities', BalanceSheetCategory: 'GST', BalanceSheetAccountName: 'GST', BalanceSheetMappingSource: 'xero_balance_sheet', BalanceSheetReason: 'Mapped from Xero Balance Sheet structure', BalanceSheetSyntheticKind: 'GST', SourceDocumentID: null, Status: null, PaymentID: null },
  ],
  balance_sheet_summary: [
    { BalanceSheetSection: 'Bank', BalanceSheetSectionPath: 'Bank', BalanceSheetCategory: 'Business Bank Account', AccountCode: '090', BalanceSheetAccountName: 'Business Bank Account', Amount: -8703.2 },
    { BalanceSheetSection: 'Current Assets', BalanceSheetSectionPath: 'Current Assets', BalanceSheetCategory: 'Accounts Receivable', AccountCode: '610', BalanceSheetAccountName: 'Accounts Receivable', Amount: -4620.0 },
    { BalanceSheetSection: 'Current Liabilities', BalanceSheetSectionPath: 'Current Liabilities', BalanceSheetCategory: 'Accounts Payable', AccountCode: '800', BalanceSheetAccountName: 'Accounts Payable', Amount: 13323.2 },
    { BalanceSheetSection: 'Current Liabilities', BalanceSheetSectionPath: 'Current Liabilities', BalanceSheetCategory: 'GST', AccountCode: '820', BalanceSheetAccountName: 'GST', Amount: -791.2 },
  ],
  income_categories: ['Sales', 'Interest Income'],
  allowed_categories: ['Sales', 'Purchases', 'Interest Income', 'Advertising', 'Bank Fees', 'Cleaning', 'Consulting & Accounting', 'Entertainment', 'Freight & Courier', 'General Expenses', 'Legal expenses', 'Light, Power, Heating', 'Motor Vehicle Expenses', 'Office Expenses', 'Printing & Stationery', 'Rent', 'Subscriptions', 'Telephone & Internet', 'Travel - National', 'Wages and Salaries', 'Unmapped'],
  review_threshold: 0.7,
}
