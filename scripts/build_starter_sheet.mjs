import fs from "node:fs/promises";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const workbook = Workbook.create();
const orders = workbook.worksheets.add("NetSuite Orders");
const rules = workbook.worksheets.add("Customer Rules");
const requests = workbook.worksheets.add("Warehouse Requests");

const green = "#183C2D", acid = "#D9FF63", line = "#E1E2DC";
function setup(sheet, headers, widths, tableName) {
  sheet.showGridLines = false;
  const last = String.fromCharCode(64 + headers.length);
  sheet.getRange(`A1:${last}1`).values = [headers];
  sheet.getRange(`A1:${last}1`).format = {
    fill: green, font: { bold: true, color: "#FFFFFF", size: 10 }, rowHeight: 30,
    verticalAlignment: "center", wrapText: true,
    borders: { bottom: { style: "medium", color: acid } },
  };
  sheet.getRange(`A2:${last}101`).format = { font: { color: "#30332F", size: 10 }, rowHeight: 23, borders: { bottom: { style: "thin", color: line } } };
  widths.forEach((w,i)=>sheet.getRangeByIndexes(0,i,101,1).format.columnWidth=w);
  sheet.freezePanes.freezeRows(1); sheet.freezePanes.freezeColumns(2);
  const table=sheet.tables.add(`A1:${last}101`,true,tableName); table.style="TableStyleMedium2"; table.showBandedRows=false;
}

setup(orders,[
  "NetSuite Order ID","Customer","PO Number","Order Date","Requested Ship Date","Order Value","NetSuite Status",
  "Customer Rules Status","Special Handling Required","Warehouse Request Status","Typeform Response ID","S1C Status",
  "Automation Hold","Human Review","BOL Status","Tracking Number","Blocker","Next Action","Owner","Last Updated"
],[18,20,16,13,17,14,17,20,21,22,22,15,17,15,15,20,28,24,16,18],"NetSuiteOrdersTable");
orders.getRange("D2:E101").setNumberFormat("yyyy-mm-dd"); orders.getRange("F2:F101").setNumberFormat("$#,##0.00"); orders.getRange("T2:T101").setNumberFormat("yyyy-mm-dd hh:mm");
orders.getRange("G2:G101").dataValidation={rule:{type:"list",values:["Not entered","Entered","Pending","Complete","Cancelled"]}};
orders.getRange("H2:H101").dataValidation={rule:{type:"list",values:["Not checked","Needs review","Matched","Exception"]}};
orders.getRange("I2:I101").dataValidation={rule:{type:"list",values:["No","Cases of 6","Floor display","Cases of 6 + floor display","Other"]}};
orders.getRange("J2:J101").dataValidation={rule:{type:"list",values:["Not needed","Needed","Drafted","Submitted","Confirmed"]}};
orders.getRange("L2:L101").dataValidation={rule:{type:"list",values:["Not started","Hold","Released","Picking","Shipped","Complete"]}};
orders.getRange("M2:M101").dataValidation={rule:{type:"list",values:["On","Off"]}};
orders.getRange("N2:N101").dataValidation={rule:{type:"list",values:["Pending","Approved","Changes needed"]}};
orders.getRange("O2:O101").dataValidation={rule:{type:"list",values:["Not needed","Missing","Requested","Received","Attached"]}};

setup(rules,["Customer","Rule Type","Rule","Applies When","Expected Value","Warehouse","Requires Typeform","Requires BOL","Manual Release Required","Source","Active","Last Verified"],[20,18,34,28,20,16,18,15,21,26,12,16],"CustomerRulesTable");
rules.getRange("G2:I101").dataValidation={rule:{type:"list",values:["Yes","No"]}}; rules.getRange("K2:K101").dataValidation={rule:{type:"list",values:["Yes","No"]}}; rules.getRange("L2:L101").setNumberFormat("yyyy-mm-dd");

setup(requests,["Request ID","NetSuite Order ID","Customer","Request Type","Warehouse","Typeform Status","Typeform Response ID","Requested Date","Required By","Submitted By","Confirmation","Notes"],[18,18,20,22,16,18,22,16,16,18,18,34],"WarehouseRequestsTable");
requests.getRange("D2:D101").dataValidation={rule:{type:"list",values:["Cases of 6","Floor display","Other"]}}; requests.getRange("F2:F101").dataValidation={rule:{type:"list",values:["Draft","Submitted","Confirmed","Cancelled"]}}; requests.getRange("H2:I101").setNumberFormat("yyyy-mm-dd");

const outputDir="outputs/019ffd0b-2069-7980-88e9-65b14faa291d";
await fs.mkdir(outputDir,{recursive:true}); await fs.mkdir("public",{recursive:true});
const output=await SpreadsheetFile.exportXlsx(workbook);
await output.save(`${outputDir}/netsuite-orders-workflow.xlsx`);
await output.save("public/starter-order-control.xlsx");
for (const sheetName of ["NetSuite Orders","Customer Rules","Warehouse Requests"]) {
  const preview=await workbook.render({sheetName,range:sheetName==="NetSuite Orders"?"A1:T10":"A1:L10",scale:1.2});
  await fs.writeFile(`${outputDir}/${sheetName.toLowerCase().replaceAll(" ","-")}.png`,new Uint8Array(await preview.arrayBuffer()));
}
console.log((await workbook.inspect({kind:"workbook,sheet,table",maxChars:5000,tableMaxRows:4,tableMaxCols:20})).ndjson);
console.log((await workbook.inspect({kind:"match",searchTerm:"#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",options:{useRegex:true,maxResults:50},summary:"formula errors"})).ndjson);
