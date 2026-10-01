"""Export the server's saved, human-reviewed mapping result without rerunning AI."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--review-file', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, default=Path('output/reviewed'))
    args = parser.parse_args()
    store = json.loads(args.review_file.read_text(encoding='utf-8'))
    if store.get('schemaVersion') != 1 or not isinstance(store.get('reportData'), dict):
        raise SystemExit('Expected a version-1 QFR review store.')
    if '-balance-sheet-' in store.get('source', ''):
        raise SystemExit('Balance-sheet reviews are audit-only. Export them from the dashboard; do not aggregate subtotals as mapping lines.')
    report = store['reportData']
    rows = pd.DataFrame(report['raw_data'])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    # Includes proposals, effective categories, source flags, saved decisions,
    # reviewer notes and timestamps. Never replaces the original AI evidence.
    rows.to_csv(args.output_dir / 'reviewed_mapping_lines.csv', index=False)
    rows.to_excel(args.output_dir / 'reviewed_mapping_lines.xlsx', index=False)
    summary = rows.groupby('MappedCategory', dropna=False)['Amount'].sum().reset_index()
    summary.to_csv(args.output_dir / 'reviewed_mapping_summary.csv', index=False)
    summary.to_excel(args.output_dir / 'reviewed_mapping_summary.xlsx', index=False)
    pd.DataFrame(store['history']).to_excel(args.output_dir / 'review_history.xlsx', index=False)
    (args.output_dir / 'reviewed_report_data.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(f'Exported {len(rows)} reviewed mapping lines to {args.output_dir}.')


if __name__ == '__main__':
    main()
