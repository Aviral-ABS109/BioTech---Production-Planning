# Demand Collection widget (v2)

Step 1 of production planning. Reads the client's monthly demand plan Excel
(sheet "Demand") as it is, checks every row, and saves one Demand record per
FG code with its Country Demand subform rows.

## Before uploading the widget
Check every link name in `src/config.js` against the application:
- Reports: All_Site_Masters, All_Planning_Types, All_Markets, Demand_Report, Demand_Upload_Report
- Site Master: `Site_Name` holds the plant code (1100…), `Planning_Type` is the multi-select
- Demand: Planning_Cycle, Plant, Type, Model, FG_Code_1, FG_Code_2, Range, Power, Cyl, Dist_Shortages,
  X3_Total, X2_Total, X1_Total, Zero_Total, Total, Status, Demand_Upload, subform Country_Demand
- Country Demand subform: Country, X3, X2, X1, Zero, Open_Orders

## Commands
npm install · npm run dev (local, test data) · npm test · npm run build · zet validate · zet pack

## Files
- src/lib/parseDemand.js – reads the Excel layout (country blocks found from the "3X" headers)
- src/lib/validate.js – row checks + record payloads
- src/lib/demandService.js – load masters, save in batches, upload log, status summary
- src/api/creator.js – only file that calls the platform SDK; src/api/mock.js – local test data
- sample-data/ – client's Oct26 file (46 valid rows) and an errors file (12 rows: 5 valid, 7 errors)
