import { buildSheets, type ColType, type ExportInput } from './exportRows';

// Writes the sheets with ExcelJS, loaded only when exporting (requirements spec 6.3).

const NUM_FMT: Partial<Record<ColType, string>> = {
  date: 'yyyy/mm/dd',
  datetime: 'yyyy/mm/dd hh:mm',
  twd: '#,##0',
  amount: '#,##0.00',
  rate: '0.000000',
  int: '0'
};

/** 'YYYY-MM-DD' → Date at UTC midnight, so Excel shows the same calendar day in any time zone. */
const excelDate = (s: string) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
/** ISO timestamp → the same wall-clock time, expressed as UTC for Excel. */
const excelDateTime = (iso: string) => {
  const t = new Date(iso);
  return new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate(), t.getHours(), t.getMinutes(), t.getSeconds()));
};

export async function buildWorkbook(input: ExportInput): Promise<ArrayBuffer> {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'CzechMate';
  wb.created = new Date();

  for (const sheet of buildSheets(input)) {
    const ws = wb.addWorksheet(sheet.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = sheet.columns.map(c => ({ header: c.header, width: c.width ?? 12, style: NUM_FMT[c.type] ? { numFmt: NUM_FMT[c.type] } : {} }));
    for (const row of sheet.rows) {
      ws.addRow(
        row.map((v, i) => {
          if (v === null || v === '') return null;
          const t = sheet.columns[i].type;
          if (t === 'date' && typeof v === 'string') return excelDate(v);
          if (t === 'datetime' && typeof v === 'string') return excelDateTime(v);
          return v;
        })
      );
    }
    const header = ws.getRow(1);
    header.font = { bold: true };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3E8D9' } };
    if (sheet.totalRow && ws.rowCount > 1) ws.getRow(ws.rowCount).font = { bold: true };
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: sheet.columns.length } };
  }
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

export function exportFileName(date: Date = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `CzechMate_記帳_${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}.xlsx`;
}
