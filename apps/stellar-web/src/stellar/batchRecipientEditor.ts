export interface BatchRecipientDraftRow {
  recipient: string;
  amount: string;
  asset: string;
}

function emptyRow(): BatchRecipientDraftRow {
  return { recipient: '', amount: '', asset: 'XLM' };
}

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === ',' && !quoted) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function splitDraftColumns(line: string): string[] {
  if (line.includes(',')) return parseCsvLine(line);
  if (line.includes('\t')) return line.split('\t').map((value) => value.trim());
  return line.trim().split(/\s+/);
}

function isHeader(values: readonly string[]): boolean {
  if (values.length !== 3) return false;
  const normalized = values.map((value) => value.trim().toLowerCase().replace(/[ _-]+/g, ''));
  return (normalized[0] === 'recipient' || normalized[0] === 'destination')
    && normalized[1] === 'amount'
    && normalized[2] === 'asset';
}

function csvCell(value: string): string {
  const trimmed = value.trim();
  return /[",\n\r]/.test(trimmed) ? `"${trimmed.replace(/"/g, '""')}"` : trimmed;
}

export function batchRecipientRowsFromInput(input: string): BatchRecipientDraftRow[] {
  const rows: BatchRecipientDraftRow[] = [];
  let firstDataLine = true;
  for (const raw of input.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const values = splitDraftColumns(raw);
    if (firstDataLine && isHeader(values)) {
      firstDataLine = false;
      continue;
    }
    firstDataLine = false;
    if (values.length === 3) {
      rows.push({ recipient: values[0] ?? '', amount: values[1] ?? '', asset: values[2] || 'XLM' });
      continue;
    }
    rows.push({ recipient: raw.trim(), amount: '', asset: 'XLM' });
  }
  return rows.length > 0 ? rows : [emptyRow()];
}

export function batchRecipientRowsToInput(rows: readonly BatchRecipientDraftRow[]): string {
  return rows
    .filter((row) => row.recipient.trim() || row.amount.trim() || (row.asset.trim() && row.asset.trim().toUpperCase() !== 'XLM'))
    .map((row) => [row.recipient, row.amount, row.asset || 'XLM'].map(csvCell).join(', '))
    .join('\n');
}

export function appendBatchRecipientRow(rows: readonly BatchRecipientDraftRow[]): BatchRecipientDraftRow[] {
  return [...rows, emptyRow()];
}

export function removeBatchRecipientRow(rows: readonly BatchRecipientDraftRow[], index: number): BatchRecipientDraftRow[] {
  const next = rows.filter((_, rowIndex) => rowIndex !== index);
  return next.length > 0 ? next : [emptyRow()];
}
