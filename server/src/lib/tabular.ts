import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { badRequest } from './errors.js';

export type Row = Record<string, string>;

export const normHeader = (h: string) =>
  h.trim().toLowerCase().replace(/[^a-z0-9:]+/g, '_').replace(/^_+|_+$/g, '');

/** Parse an uploaded CSV or XLSX file into rows keyed by normalized header. */
export async function parseTabular(file: { buffer: Buffer; originalname: string; mimetype: string }): Promise<Row[]> {
  const name = file.originalname.toLowerCase();
  if (name.endsWith('.xlsx')) {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(file.buffer as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest('The workbook has no worksheets');
    const headers: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => (headers[col] = normHeader(String(cell.text ?? ''))));
    const rows: Row[] = [];
    ws.eachRow((row, idx) => {
      if (idx === 1) return;
      const r: Row = {};
      headers.forEach((h, col) => {
        if (h) r[h] = String(row.getCell(col).text ?? '').trim();
      });
      if (Object.values(r).some((v) => v !== '')) rows.push(r);
    });
    return rows;
  }
  if (name.endsWith('.csv') || file.mimetype.includes('csv') || file.mimetype === 'text/plain') {
    const text = file.buffer.toString('utf8').replace(/^﻿/, '');
    const records = parse(text, { columns: (h: string[]) => h.map(normHeader), skip_empty_lines: true, trim: true, relax_column_count: true }) as Row[];
    return records;
  }
  throw badRequest('Upload a .csv or .xlsx file');
}
