/**
 * One-time script: parse seed/biodata/*.pdf (or --dir <path>) into the
 * `helpers` table. Text-based PDFs are parsed with pdf-parse; PDFs with no
 * extractable text (scanned images) are flagged into `needs_manual_review`
 * instead of guessed at.
 *
 * Usage:
 *   npm run ingest-biodata               # seed/biodata, writes to Supabase
 *   npm run ingest-biodata -- --dry-run  # force local JSON output, skip DB
 *
 * If SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set, the script runs
 * in dry-run mode automatically: it still does full parsing and prints the
 * hit-rate report, but writes records to scripts/output/ instead of
 * Postgres. This is expected in this sandbox — see docs/phase0-analysis.md
 * and the phase report for what to do to run it against a real project.
 *
 * KNOWN QUIRK, WORTH READING BEFORE TOUCHING THE REGEXES:
 * pdf-parse's default text extraction concatenates each PDF text run
 * verbatim with no inferred spacing. For most PDFs the runs already contain
 * spaces, so this is invisible. For at least one real file in this
 * project's seed data (a WPS-Docs-generated biodata form), the space
 * character is never actually in the content stream — words are joined by
 * positioning offsets only ("BIO-DATAOFFOREIGNDOMESTICWORKER..."). Rather
 * than write a dictionary word-segmentation hack, `renderPageWithSpacing`
 * below reads pdf.js's character-level text items directly and reinserts
 * spaces/newlines from the horizontal/vertical gaps between glyphs — the
 * same thing poppler's pdftotext does internally. This is still pdf-parse
 * (same library, same dependency), just with a corrected page-render hook.
 */
import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "dotenv/config";
import pdfParse from "pdf-parse";
import { createClient } from "@supabase/supabase-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const dirArgIdx = args.indexOf("--dir");
const BIODATA_DIR =
  dirArgIdx >= 0 && args[dirArgIdx + 1]
    ? path.resolve(REPO_ROOT, args[dirArgIdx + 1])
    : path.join(REPO_ROOT, "seed", "biodata");
const FORCE_DRY_RUN = args.includes("--dry-run");
const OUTPUT_DIR = path.join(REPO_ROOT, "scripts", "output");

const MIN_TEXT_LENGTH_FOR_PARSEABLE = 80; // below this, treat as scanned/no text layer

// ---------------------------------------------------------------------------
// PDF text extraction with corrected spacing (see module doc comment above)
// ---------------------------------------------------------------------------

const Y_TOLERANCE = 2; // points; glyphs within this y-delta are the same line
const SPACE_GAP_THRESHOLD = 1.2; // points; x-gap beyond this becomes a space

function renderPageWithSpacing(pageData: any): Promise<string> {
  return pageData
    .getTextContent({ normalizeWhitespace: false, disableCombineTextItems: true })
    .then((textContent: { items: Array<{ str: string; transform: number[]; width: number }> }) => {
      const lines: string[] = [];
      let curLine: string[] = [];
      let lastY: number | null = null;
      let lastEndX: number | null = null;

      for (const item of textContent.items) {
        if (!item.str) continue;
        const y = item.transform[5];
        const x = item.transform[4];

        if (lastY === null || Math.abs(y - lastY) > Y_TOLERANCE) {
          if (curLine.length) lines.push(curLine.join(""));
          curLine = [];
          lastEndX = null;
        }
        if (lastEndX !== null) {
          const gap = x - lastEndX;
          if (gap > SPACE_GAP_THRESHOLD) curLine.push(" ");
        }
        curLine.push(item.str);
        lastY = y;
        lastEndX = x + item.width;
      }
      if (curLine.length) lines.push(curLine.join(""));
      return lines.join("\n") + "\n\n";
    });
}

async function extractText(buf: Buffer): Promise<{ text: string; numPages: number }> {
  const data = await pdfParse(buf, { pagerender: renderPageWithSpacing });
  return { text: data.text, numPages: data.numpages };
}

// ---------------------------------------------------------------------------
// Field extraction — regexes against the standard MOM/CEA biodata form.
// Every extractor returns null (not a guess) when its pattern doesn't match.
// This form is the ONLY template seen in the seed data (n=1); expect to
// widen these when biodata from other agencies with different layouts shows
// up — that's a "extraction hit rate dropped" signal, not a bug to silently
// patch around.
// ---------------------------------------------------------------------------

type Skills = {
  infant_care: boolean | null;
  elderly_care: boolean | null;
  handicap_care: boolean | null;
  general_housework: boolean | null;
  cooking: boolean | null;
  pets: boolean | null;
};

interface HelperRecord {
  name: string | null;
  nationality: string | null;
  date_of_birth: string | null;
  age: number | null;
  marital_status: string | null;
  num_children: number | null;
  years_experience: number | null;
  prior_work_placements: string[] | null;
  skills: Skills;
  languages: string[] | null;
  expected_salary_monthly: number | null;
  off_day_expectation: string | null;
  rest_day_arrangement: string | null;
  availability_status: string | null;
  source_pdf_path: string;
  raw_text: string;
  notes: string | null;
}

interface FieldHit {
  field: string;
  hit: boolean;
}

function matchOne(text: string, re: RegExp): string | null {
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

function extractSkillPair(text: string, label: string): boolean | null {
  // Matches e.g. "Care of elderly YES YES ..." -> (willingness, experience)
  // We treat the record as having the skill when EITHER column is YES,
  // since willingness-only ("YES" then no experience stated) still means
  // she's offering the skill.
  const re = new RegExp(`${label}[^\\n]*?\\n?[^\\n]*?\\b(YES|NO)\\b(?:\\s+(YES|NO))?`, "i");
  const m = text.match(re);
  if (!m) return null;
  return m[1]?.toUpperCase() === "YES" || m[2]?.toUpperCase() === "YES";
}

function parseEmploymentHistory(text: string): { years: number | null; placements: string[] } {
  // Lines like "2018 2021 JAKARTA MUSLIM EMP"
  const re = /^(\d{4})\s+(\d{4})\s+([A-Z][A-Z ]*?)\s+([A-Z][A-Z ]*EMP)\b/gm;
  let m: RegExpExecArray | null;
  let totalYears = 0;
  let matched = false;
  const placements: string[] = [];
  while ((m = re.exec(text)) !== null) {
    matched = true;
    const from = parseInt(m[1], 10);
    const to = parseInt(m[2], 10);
    if (to > from) totalYears += to - from;
    const place = m[3].trim();
    if (!placements.includes(place)) placements.push(place);
  }
  return { years: matched ? totalYears : null, placements };
}

function extractFields(rawText: string, sourcePdfPath: string): { record: HelperRecord; fieldHits: FieldHit[] } {
  // Normalize a couple of curly-quote/typo variants seen in the source form.
  const text = rawText;

  const name = matchOne(text, /\d+\.\s*Name:\s*([A-Z .'-]+?)(?:\n|$)/);
  const nationality = matchOne(text, /Nationality:\s*([A-Z]+)/);
  const dob = matchOne(text, /Date of birth:\s*([\d/-]+)/i);
  const ageStr = matchOne(text, /Date of birth:.*?Age:\s*(\d+)/i);
  const maritalStatus = matchOne(text, /Marital status:\s*([A-Z]+)/i);
  const numChildrenStr = matchOne(text, /Number of children:\s*(\d+)/i);
  const offDayRaw = matchOne(text, /Preference for rest day:\s*(\d+)\s*rest day\(s\)\s*per month/i);
  const remarksRaw = matchOne(text, /Any other remarks:\s*([^\n]+)/i);
  const spokenLanguageNote = matchOne(
    text,
    /Language abilities \(spoken\)[\s\S]{0,60}?\bYES\b\s*([A-Z][A-Z ]*[A-Z])/,
  );

  const { years: yearsExperience, placements } = parseEmploymentHistory(text);

  const skills: Skills = {
    infant_care: extractSkillPair(text, "Care of infants/children"),
    elderly_care: extractSkillPair(text, "Care of elderly"),
    handicap_care: extractSkillPair(text, "Care of disabled"),
    general_housework: extractSkillPair(text, "General housework"),
    cooking: extractSkillPair(text, "Cooking"),
    pets: null,
  };

  // Pets: the standard form has no dedicated skills-table row for this.
  // If the employment-history duties literally mention pet care, record it
  // as true and say exactly where that came from in `notes` — this is
  // reading real text elsewhere in the same document, not a guess.
  const petsNoteMatch = text.match(/\b(\d+\s+)?(DOGS?|CATS?|PETS?)\b[\s\S]{0,40}?(FEEDING|WALK|WASTE|GROOM)/i);
  let petsNote: string | null = null;
  if (petsNoteMatch) {
    skills.pets = true;
    const snippet = petsNoteMatch[0].replace(/\s+/g, " ").trim();
    petsNote = `Pet-care experience inferred from employment-history duties ("${snippet}"), not from the skills-assessment table (this form has no dedicated pets row).`;
  }

  const languages: string[] | null = spokenLanguageNote ? [spokenLanguageNote.trim()] : null;

  const notesParts: string[] = [];
  if (remarksRaw) notesParts.push(`Form remarks: ${remarksRaw.trim()}`);
  if (petsNote) notesParts.push(petsNote);
  notesParts.push(
    "availability_status left null: the form's availability section is a checkbox group and text extraction cannot determine which box is ticked.",
  );
  if (placements.length) {
    notesParts.push(
      `prior_work_placements (${placements.join(", ")}) are literal locations from the employment-history table, not necessarily overseas countries — verify before treating as international experience.`,
    );
  }

  const record: HelperRecord = {
    name,
    nationality,
    date_of_birth: dob,
    age: ageStr ? parseInt(ageStr, 10) : null,
    marital_status: maritalStatus,
    num_children: numChildrenStr ? parseInt(numChildrenStr, 10) : null,
    years_experience: yearsExperience,
    prior_work_placements: placements.length ? placements : null,
    skills,
    languages,
    expected_salary_monthly: null, // never present on this form template; negotiated separately
    off_day_expectation: offDayRaw ? `${offDayRaw} rest day(s) per month` : null,
    rest_day_arrangement: null, // not distinguished from off_day_expectation on this form
    availability_status: null,
    source_pdf_path: sourcePdfPath,
    raw_text: rawText,
    notes: notesParts.join(" "),
  };

  const fieldHits: FieldHit[] = [
    { field: "name", hit: !!record.name },
    { field: "nationality", hit: !!record.nationality },
    { field: "date_of_birth", hit: !!record.date_of_birth },
    { field: "age", hit: record.age !== null },
    { field: "marital_status", hit: !!record.marital_status },
    { field: "num_children", hit: record.num_children !== null },
    { field: "years_experience", hit: record.years_experience !== null },
    { field: "prior_work_placements", hit: !!record.prior_work_placements },
    { field: "skills.infant_care", hit: record.skills.infant_care !== null },
    { field: "skills.elderly_care", hit: record.skills.elderly_care !== null },
    { field: "skills.handicap_care", hit: record.skills.handicap_care !== null },
    { field: "skills.general_housework", hit: record.skills.general_housework !== null },
    { field: "skills.cooking", hit: record.skills.cooking !== null },
    { field: "skills.pets", hit: record.skills.pets !== null },
    { field: "languages", hit: !!record.languages },
    { field: "expected_salary_monthly", hit: record.expected_salary_monthly !== null },
    { field: "off_day_expectation", hit: !!record.off_day_expectation },
    { field: "rest_day_arrangement", hit: !!record.rest_day_arrangement },
    { field: "availability_status", hit: !!record.availability_status },
  ];

  return { record, fieldHits };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  if (!existsSync(BIODATA_DIR)) {
    console.error(`No biodata directory at ${BIODATA_DIR}`);
    process.exit(1);
  }
  const files = (await readdir(BIODATA_DIR)).filter((f) => f.toLowerCase().endsWith(".pdf"));
  if (files.length === 0) {
    console.error(`No PDFs found in ${BIODATA_DIR}`);
    process.exit(1);
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const dryRun = FORCE_DRY_RUN || !supabaseUrl || !supabaseKey;
  const supabase = dryRun ? null : createClient(supabaseUrl!, supabaseKey!);

  console.log(`Ingesting ${files.length} PDF(s) from ${path.relative(REPO_ROOT, BIODATA_DIR)}`);
  console.log(dryRun ? "Mode: DRY RUN (no Supabase credentials or --dry-run passed) — writing to scripts/output/ instead of Postgres.\n" : "Mode: LIVE — writing to Supabase.\n");

  const helperRows: HelperRecord[] = [];
  const manualReviewRows: Array<{ source_pdf_path: string; reason: string; text_length: number }> = [];
  const hitRateAgg: Record<string, { hits: number; total: number }> = {};

  for (const file of files) {
    const fullPath = path.join(BIODATA_DIR, file);
    const relPath = path.relative(REPO_ROOT, fullPath);
    const buf = await readFile(fullPath);

    let text = "";
    let numPages = 0;
    try {
      const extracted = await extractText(buf);
      text = extracted.text;
      numPages = extracted.numPages;
    } catch (err) {
      console.log(`  [FAIL]  ${file} — pdf-parse threw: ${(err as Error).message}`);
      manualReviewRows.push({ source_pdf_path: relPath, reason: `pdf-parse error: ${(err as Error).message}`, text_length: 0 });
      continue;
    }

    if (text.trim().length < MIN_TEXT_LENGTH_FOR_PARSEABLE) {
      console.log(`  [SCAN]  ${file} — only ${text.trim().length} chars extracted (${numPages} pages) — flagged for manual review, not parsed.`);
      manualReviewRows.push({
        source_pdf_path: relPath,
        reason: "no extractable text (likely scanned / image-based PDF)",
        text_length: text.trim().length,
      });
      continue;
    }

    const { record, fieldHits } = extractFields(text, relPath);
    for (const { field, hit } of fieldHits) {
      hitRateAgg[field] ??= { hits: 0, total: 0 };
      hitRateAgg[field].total += 1;
      if (hit) hitRateAgg[field].hits += 1;
    }
    helperRows.push(record);
    const hitCount = fieldHits.filter((f) => f.hit).length;
    console.log(`  [OK]    ${file} — name="${record.name ?? "?"}" — ${hitCount}/${fieldHits.length} fields extracted`);
  }

  // --- Persist ---
  await mkdir(OUTPUT_DIR, { recursive: true });

  if (dryRun) {
    await writeFile(path.join(OUTPUT_DIR, "helpers.dry-run.json"), JSON.stringify(helperRows, null, 2));
    await writeFile(path.join(OUTPUT_DIR, "needs_manual_review.dry-run.json"), JSON.stringify(manualReviewRows, null, 2));
    console.log(`\nWrote ${helperRows.length} helper record(s) to scripts/output/helpers.dry-run.json`);
    console.log(`Wrote ${manualReviewRows.length} manual-review record(s) to scripts/output/needs_manual_review.dry-run.json`);
  } else {
    if (helperRows.length) {
      const { error } = await supabase!.from("helpers").insert(helperRows);
      if (error) throw new Error(`Supabase insert into helpers failed: ${error.message}`);
    }
    if (manualReviewRows.length) {
      const { error } = await supabase!.from("needs_manual_review").insert(manualReviewRows);
      if (error) throw new Error(`Supabase insert into needs_manual_review failed: ${error.message}`);
    }
    console.log(`\nInserted ${helperRows.length} row(s) into helpers, ${manualReviewRows.length} into needs_manual_review.`);
  }

  // --- Hit-rate report ---
  const reportLines: string[] = [];
  reportLines.push("# Biodata ingestion report");
  reportLines.push("");
  reportLines.push(`Run: ${new Date().toISOString()}`);
  reportLines.push(`Source directory: \`${path.relative(REPO_ROOT, BIODATA_DIR)}\``);
  reportLines.push(`Mode: ${dryRun ? "dry run (no Supabase credentials)" : "live Supabase write"}`);
  reportLines.push("");
  reportLines.push(`PDFs processed: ${files.length}`);
  reportLines.push(`Parsed into \`helpers\`: ${helperRows.length}`);
  reportLines.push(`Flagged into \`needs_manual_review\`: ${manualReviewRows.length}`);
  reportLines.push("");
  reportLines.push("## Per-field extraction hit rate (across parsed PDFs)");
  reportLines.push("");
  reportLines.push("| Field | Hits | Total | Rate |");
  reportLines.push("|---|---|---|---|");
  for (const [field, { hits, total }] of Object.entries(hitRateAgg)) {
    const rate = total ? ((hits / total) * 100).toFixed(0) : "0";
    reportLines.push(`| ${field} | ${hits} | ${total} | ${rate}% |`);
  }
  if (manualReviewRows.length) {
    reportLines.push("");
    reportLines.push("## Flagged for manual review");
    reportLines.push("");
    for (const row of manualReviewRows) {
      reportLines.push(`- \`${row.source_pdf_path}\` — ${row.reason} (${row.text_length} chars extracted)`);
    }
  }
  reportLines.push("");
  reportLines.push(
    "**Sample size caveat**: this run processed the single biodata PDF currently in `seed/biodata/`. " +
      "A hit rate from n=1 tells you the parser works on one real MOM/CEA-template form — it does not " +
      "tell you the hit rate on other agencies' layouts or scanned submissions until more PDFs are added.",
  );

  const reportPath = path.join(OUTPUT_DIR, "ingest-report.md");
  await writeFile(reportPath, reportLines.join("\n") + "\n");
  console.log(`\nReport written to ${path.relative(REPO_ROOT, reportPath)}`);
  console.log("\n" + reportLines.join("\n"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
