/** Export an array of objects as a CSV file download in the browser. */
export function exportCsv<T extends Record<string, unknown>>(
  rows: T[],
  filename: string,
  columns?: { key: keyof T; label: string }[],
) {
  if (rows.length === 0) return;

  const cols = columns || Object.keys(rows[0]).map((key) => ({ key: key as keyof T, label: String(key) }));

  const escape = (val: unknown) => {
    const str = val == null ? '' : String(val);
    // Wrap in quotes if it contains a comma, quote, or newline
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = cols.map((c) => escape(c.label)).join(',');
  const body = rows.map((row) => cols.map((c) => escape(row[c.key])).join(',')).join('\n');
  const csv = `${header}\n${body}`;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
