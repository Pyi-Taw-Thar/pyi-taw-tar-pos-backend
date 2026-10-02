/* One-off converter: finance-admin.invoices.json -> .xlsx
 * Uses SheetJS (xlsx) already present in backend/node_modules.
 * Dates are converted from UTC to Myanmar time (UTC+6:30) and stored as
 * native Excel date cells.
 */
const fs = require("fs");
const path = require("path");
const XLSX = require("xlsx");

const SRC = "C:/Users/PC/Downloads/finance-admin.invoices.json";
const OUT = "C:/Users/PC/Downloads/finance-admin.invoices.xlsx";

const MM_OFFSET_MS = 6.5 * 3600 * 1000; // Myanmar Standard Time = UTC+6:30

const data = JSON.parse(fs.readFileSync(SRC, "utf8"));

// --- helpers ---------------------------------------------------------------
const oid = (v) => (v && v.$oid) ? v.$oid : "";
const txt = (v) => (v === undefined || v === null) ? "" : String(v).trim();

// Convert a Mongo {$date: "..."} to an Excel serial number in Myanmar time.
function toExcelSerial(v) {
  if (!v || !v.$date) return null;
  const d = new Date(v.$date);
  if (isNaN(d.getTime())) return null;
  const shifted = new Date(d.getTime() + MM_OFFSET_MS);
  return shifted.getTime() / 86400000 + 25569; // 25569 = 1970-01-01 in Excel epoch
}

// Column definitions: [header, accessor, type, width]
// types: text | int | money | rate | date | datetime | bool
const COLS = [
  ["Invoice No",              (r) => txt(r.invoiceNumber),        "text",     20],
  ["Invoice Date",            (r) => toExcelSerial(r.date),        "date",     13],
  ["Customer Name",           (r) => txt(r.customerName),          "text",     22],
  ["Caregiver Name",          (r) => txt(r.caregiverName),         "text",     22],
  ["Duty Type",               (r) => txt(r.dutyType),              "text",     18],
  ["Service Package",         (r) => txt(r.servicePackage),        "text",     18],
  ["Amount",                  (r) => r.amount,                     "money",    13],
  ["Platform Fee Type",       (r) => txt(r.platformFeeType),       "text",     16],
  ["Platform Fee Rate",       (r) => r.platformFeeRate,            "rate",     16],
  ["Platform Fee",            (r) => r.platformFee,                "money",    13],
  ["Service Start",           (r) => toExcelSerial(r.serviceStartDate), "date", 13],
  ["Service End",             (r) => toExcelSerial(r.serviceEndDate),   "date", 13],
  ["Due Date",                (r) => toExcelSerial(r.dueDate),     "date",     13],
  ["Payment Method",          (r) => txt(r.paymentMethod),         "text",     16],
  ["Invoice Status",          (r) => txt(r.invoiceStatus),         "text",     14],
  ["Customer Payment Status", (r) => txt(r.customerPaymentStatus), "text",     16],
  ["Caregiver Payout Status", (r) => txt(r.caregiverPayoutStatus), "text",     16],
  ["Status",                  (r) => txt(r.status),                "text",     12],
  ["Locked",                  (r) => (r.isLocked ? "Yes" : "No"),  "text",     8],
  ["Created At (MMT)",        (r) => toExcelSerial(r.createdAt),   "datetime", 18],
  ["Updated At (MMT)",        (r) => toExcelSerial(r.updatedAt),   "datetime", 18],
  ["Invoice ID",              (r) => oid(r._id),                   "text",     26],
  ["Parent ID",               (r) => oid(r.parent),                "text",     26],
  ["Caregiver ID",            (r) => oid(r.caregiver),             "text",     26],
  ["Booking ID",              (r) => oid(r.booking),               "text",     26],
];

// Sort chronologically by invoice number (encodes date + daily sequence).
data.sort((a, b) => txt(a.invoiceNumber).localeCompare(txt(b.invoiceNumber)));

const FMT = {
  money: "#,##0",
  rate: "#,##0.##",
  date: "yyyy-mm-dd",
  datetime: "yyyy-mm-dd hh:mm",
};

const ws = {};
const nRows = data.length;
const nCols = COLS.length;
const totalRow = nRows + 1; // 0-based row index of the totals row

function setCell(r, c, value, type) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (value === null || value === undefined || value === "") {
    // leave empty for blank text; but keep 0 numbers
    if (type === "text" || type === "date" || type === "datetime") return;
  }
  let cell;
  if (type === "date" || type === "datetime") {
    cell = { t: "n", v: value, z: FMT[type] };
  } else if (type === "money") {
    cell = { t: "n", v: (typeof value === "number" ? value : 0), z: FMT.money };
  } else if (type === "rate") {
    cell = (value === null || value === undefined || value === "")
      ? null
      : { t: "n", v: value, z: FMT.rate };
  } else if (type === "int") {
    cell = { t: "n", v: value };
  } else {
    cell = { t: "s", v: String(value) };
  }
  if (cell) ws[addr] = cell;
}

// Header row
COLS.forEach((col, c) => {
  ws[XLSX.utils.encode_cell({ r: 0, c })] = { t: "s", v: col[0] };
});

// Data rows
data.forEach((rec, i) => {
  const r = i + 1;
  COLS.forEach((col, c) => {
    const [, accessor, type] = col;
    setCell(r, c, accessor(rec), type);
  });
});

// Totals row (SUM formulas for Amount [G] and Platform Fee [J])
const colLetter = (c) => XLSX.utils.encode_col(c);
const amountCol = COLS.findIndex((x) => x[0] === "Amount");
const feeCol = COLS.findIndex((x) => x[0] === "Platform Fee");
ws[XLSX.utils.encode_cell({ r: totalRow, c: amountCol - 1 })] = { t: "s", v: "TOTAL" };
{
  const L = colLetter(amountCol);
  ws[XLSX.utils.encode_cell({ r: totalRow, c: amountCol })] =
    { t: "n", f: `SUM(${L}2:${L}${nRows + 1})`, z: FMT.money };
}
{
  const L = colLetter(feeCol);
  ws[XLSX.utils.encode_cell({ r: totalRow, c: feeCol })] =
    { t: "n", f: `SUM(${L}2:${L}${nRows + 1})`, z: FMT.money };
}

// Sheet range, column widths, autofilter
ws["!ref"] = XLSX.utils.encode_range(
  { r: 0, c: 0 },
  { r: totalRow, c: nCols - 1 }
);
ws["!cols"] = COLS.map((col) => ({ wch: col[3] }));
ws["!autofilter"] = {
  ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: nRows, c: nCols - 1 }),
};

const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, "Invoices");
XLSX.writeFile(wb, OUT, { bookType: "xlsx", cellDates: false });

console.log(`OK: ${nRows} rows -> ${OUT}`);
