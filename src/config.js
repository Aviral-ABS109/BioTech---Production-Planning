// ─────────────────────────────────────────────────────────────────────────────
// Every form / report / field link name the widget uses lives in this file.
// If something in the app is named differently, change it here only.
// Link names are case-sensitive (form builder → field properties → link name;
// report link name is the last part of the report URL: .../#Report:<name>).
// ─────────────────────────────────────────────────────────────────────────────

export const APP_NAME = undefined; // undefined = the application the widget is installed in

export const FORMS = {
  demand: 'Demand',
  demandUpload: 'Demand_Upload',
  sitePlanStatus: 'Site_Plan_Status', // one record per planning cycle + site
};

// Master forms the widget adds records to (Masters section + new countries on upload).
// Several link names may be listed: the first one the app accepts is used, so a
// rename (Site Master → Sites, Market → Country) does not break the widget.
export const MASTER_FORMS = {
  site: ['Sites', 'Site_Master'],
  planningType: ['Planning_Type'],
  country: ['Country', 'Market'],
};

// Countries in an uploaded file that are not in the Country master are added
// automatically (Active) when the demand is saved. Names that look like a
// misspelling of an existing country are rejected instead.
export const AUTO_ADD_COUNTRIES = true;

// Logged-in user shown in the sidebar. The widget always knows the user's email;
// name and role come from an optional custom API (Microservices → Custom API) that
// returns { name, email, role, profile }. Set api_name to null to use the email only.
export const USER_API = {
  api_name: 'get_current_user',
  public_key: null, // only if the custom API uses Public Key authentication
};

export const REPORTS = {
  siteMaster: 'All_Site_Masters',
  planningTypes: 'All_Planning_Types',
  markets: 'All_Countries', // Country master (was Market)
  demands: 'Demand_Report',
  demandUploads: 'Demand_Upload_Report',
  sitePlanStatus: 'All_Site_Plan_Status',
};

export const F = {
  // Site Master: the field holding the plant code (1100, 2100…) and the
  // multi-select lookup of planning types
  // active: link name of an "Active" checkbox, or null if the form has none
  site: { code: 'Site_Name', types: 'Planning_Type', active: null },
  planningType: { name: 'Type_Name', active: null },
  market: { name: 'Country_Name', active: 'Active' }, // Country master fields
  // One Demand record = one FG code + one country (no subform).
  // Dist. Shortages and the X3/X2/X1/Zero totals are per FG code and repeated
  // on every country record of that FG code (same as the Excel's total columns).
  demand: {
    cycle: 'Planning_Cycle', // single line, e.g. OCT'26 (chosen in the widget)
    country: 'Country', // lookup → Country master
    x3: 'X3',
    x2: 'X2',
    x1: 'X1',
    zero: 'Zero',
    open: 'Open_Orders',
    plant: 'Plant',
    type: 'Type_field', // 'Type' is reserved, the builder renames it
    model: 'Model',
    fg1: 'FG_Code_1',
    fg2: 'FG_Code_2',
    range: 'Range',
    power: 'Power',
    cyl: 'Cyl',
    dist: 'Dist_Shortages',
    x3Total: 'X3_Total',
    x2Total: 'X2_Total',
    x1Total: 'X1_Total',
    zeroTotal: 'Zero_Total',
    total: 'Total', // Dist + 3X/2X/1X/ZERO totals of the FG code (formula or decimal)
    status: 'Status',
    upload: 'Demand_Upload', // lookup → Demand Upload form (set to null to skip linking)
  },
  // Site Plan Status: where each site is in the planning process for a cycle
  planStatus: {
    cycle: 'Planning_Cycle', // single line, same text as Demand.Planning_Cycle
    site: 'Site', // lookup → Sites
    stage: 'Stage', // dropdown, values = PLAN_STAGES
    updatedOn: 'Stage_Updated_On', // date-time (skipped automatically if the format is rejected)
    updatedBy: 'Updated_By', // single line
  },
  upload: {
    name: 'Upload_Name',
    cycle: 'Planning_Cycle', // single line; skipped automatically if it rejects text
    file: 'Source_File',
    totalRows: 'Total_Rows',
    successRows: 'Success_Rows',
    failedRows: 'Failed_Rows',
    skippedRows: 'Skipped_Rows',
    status: 'Status',
    uploadedBy: 'Uploaded_By',
    log: 'Error_Log',
  },
};

// Planning stages, in order (the client's process). Must match the Stage dropdown
// options exactly. The last one means the site's plan is complete.
export const PLAN_STAGES = [
  'Demand Collection',
  'Production Planning',
  'Material Management',
  'Capacity Calculation',
  'Review & Approve',
  'Proceed for Signoff',
  'Signed Off',
];
// Short names for the tracker chips (same order)
export const PLAN_STAGE_SHORT = ['Demand', 'Production', 'Material', 'Capacity', 'Review', 'Signoff', 'Signed off'];

// Quantities are rounded to this many decimals before saving (must not exceed
// the decimal places of the X3/X2/X1/Zero/Open_Orders/Dist/Total fields)
export const QTY_DECIMALS = 2;

// Demand Upload Status after all its records are deleted from Upload history
// (add this option to the Status field if it is a dropdown)
export const UPLOAD_DELETED = 'Deleted';

// Value written to Demand.Status for rows that passed the checks
export const STATUS_VALIDATED = 'Validated';

// Range is a single-line field: any value is accepted. These known values are
// matched case-insensitively and saved in this spelling ("low" → "Low"), and are
// offered as suggestions when editing a record.
export const RANGE_VALUES = ['Running', 'Low', 'NA'];
export const RANGE_MAX_LENGTH = 255; // single-line field limit

// Planning cycle text written to Planning_Cycle, built from the month + year
// picked in the widget. 'MON\'YY' → OCT'26 · 'Mon YYYY' → Oct 2026 · 'MM-YYYY' → 10-2026
export const CYCLE_FORMAT = "MON'YY";
// Years offered in the picker, relative to the current year
export const CYCLE_YEARS_BACK = 1;
export const CYCLE_YEARS_AHEAD = 1;

// ── Excel layout (client's demand plan format) ─────────────────────────────
// Headers are matched ignoring case, spaces, dots, dashes and underscores.
export const FIXED_HEADERS = {
  plant: ['plant', 'site'],
  type: ['type', 'planning type'],
  model: ['model'],
  fg1: ['fg code 1', 'fg code', 'fg code1', 'code-01'],
  fg2: ['fg code 2', 'fg code2', 'code-02'],
  range: ['range'],
  power: ['power', 'diopter'],
  cyl: ['cyl', 'cyl.', 'cylinder'],
  dist: ['dist. shortages', 'dist shortages', 'dist shortage', 'distributor shortages'],
  fileTotal: ['total'],
  // long format only: one row per FG code per country
  country: ['country', 'market'],
};
export const REQUIRED_HEADERS = ['plant', 'type', 'fg1'];
// Quantity columns. Long format: one set + a Country column.
// Old wide format: one block per country, starting at "3X"
export const BUCKET_HEADERS = {
  x3: ['3x'],
  x2: ['2x'],
  x1: ['1x'],
  zero: ['zero', '0x'],
  open: ['open orders', 'open order'],
};

// Records per add call (the app allows up to 200)
export const BATCH_SIZE = 100;

// Rows already uploaded for the same cycle + plant + FG code 1 + country: 'skip' or 'error'
export const DUPLICATE_POLICY = 'skip';

// Rows shown per page in the preview table
export const PAGE_SIZE = 100;
