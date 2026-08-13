import { useRef, useState } from "react";
import { ArrowDownUp, ChevronDown, Columns3, Filter, FolderPlus, Globe2, Home, Inbox, Mail, MoreHorizontal, MousePointer2, PanelLeft, Plus, Radio, Redo2, Search, Share2, Sparkles, TableProperties, Undo2, Upload, UsersRound, Zap } from "lucide-react";
import * as XLSX from "xlsx";
import { integrations } from "./integrations";

type Row = Record<string, string | number | boolean>;
const starter = "/starter-order-control.xlsx";
const defaultColumns = ["NetSuite Order ID","Customer","PO Number","Order Date","Requested Ship Date","Order Value","NetSuite Status","Customer Rules Status","Special Handling Required","Warehouse Request Status","Typeform Response ID","S1C Status","Automation Hold","Human Review","BOL Status","Tracking Number","Blocker","Next Action","Owner","Last Updated"];

export default function App(){
  const input = useRef<HTMLInputElement>(null);
  const [name,setName]=useState("NetSuite Orders");
  const [columns,setColumns]=useState(defaultColumns);
  const [rows,setRows]=useState<Row[]>([]);
  const [selected,setSelected]=useState<{r:number;c:number}|null>(null);
  const [connected,setConnected]=useState(true);
  const [view,setView]=useState<"sheet"|"sources">("sheet");

  async function load(file?:File){
    if(!file)return;
    const wb=XLSX.read(await file.arrayBuffer());
    const ws=wb.Sheets[wb.SheetNames[0]];
    const data=XLSX.utils.sheet_to_json<Row>(ws,{defval:""});
    const headers=(XLSX.utils.sheet_to_json<(string|number)[]>(ws,{header:1,blankrows:false})[0]||[]).map(String);
    setColumns(headers.length?headers:defaultColumns); setRows(data); setName(file.name.replace(/\.[^.]+$/, "")); setConnected(true);
  }
  const cellValue=selected ? String(rows[selected.r]?.[columns[selected.c]]??"") : "Select cell";
  return <div className="pd-app">
    <aside className="pd-sidebar">
      <div className="workspace-switch"><span className="avatar">D</span><strong>Danica Aurelie's …</strong><ChevronDown size={14}/><button><PanelLeft size={16}/></button></div>
      <div className="new-sheet"><button className="sheet-name" onClick={()=>{setName("NetSuite Orders");setColumns(defaultColumns);setRows([]);setConnected(true)}}>New sheet</button><button className="blue-square"><Plus size={16}/></button><button className="outline-square" onClick={()=>input.current?.click()}><Upload size={15}/></button></div>
      <nav><button><Search size={15}/>Search</button><button onClick={()=>setView("sheet")} className={view==="sheet"?"active":""}><Home size={15}/>Orders</button><button onClick={()=>setView("sources")} className={view==="sources"?"active":""}><MousePointer2 size={15}/>Connections</button><button><Inbox size={15}/>Email intake</button></nav>
      <Section title="Shared"><button><UsersRound size={15}/>Shared with me</button><button><Globe2 size={15}/>Public sheets</button></Section>
      <Section title="Private"><button className="active"><Columns3 size={14}/>{name}</button></Section>
      <Section title="Team"/>
      <button className="help">? </button>
    </aside>
    <section className="pd-sheet">
      {view==="sources" ? <SourcesPanel onBack={()=>setView("sheet")}/> : <>
      <header className="sheet-top"><div className="title"><span>{name}</span><MoreHorizontal size={16}/></div><div className="top-tools"><button><Undo2 size={16}/></button><button><Redo2 size={16}/></button><i/><button>Auto <ChevronDown size={13}/></button><span className="credits"><b/>500 credits</span><button className="enrich"><Sparkles size={15}/> Enrich</button><button className="share"><Share2 size={15}/> Share</button></div></header>
      <div className="subbar"><span>{cellValue}</span><div><button><Zap size={14}/>Run order: <strong>Sequential</strong><ChevronDown size={13}/></button><button><Radio size={14}/>Signals</button><button><Filter size={15}/></button><button><ArrowDownUp size={15}/></button><button><Columns3 size={15}/></button><button><Mail size={15}/></button><button><Search size={15}/></button></div></div>
      {!connected ? <div className="blank-sheet">
        <div className="blank-grid" aria-hidden="true"/>
        <div className="blank-card"><span className="blank-icon"><Columns3 size={22}/></span><h2>NetSuite orders workflow</h2><p>Start with blank order, customer-rules, and warehouse-request tabs.</p><button className="import-main" onClick={()=>input.current?.click()}><Upload size={15}/>Import sheet</button><a href={starter} download>Download workflow</a></div>
      </div> : <Grid columns={columns} rows={rows} selected={selected} setSelected={setSelected}/>} 
      <footer><button onClick={()=>setRows([...rows,{}])}><Plus size={15}/>Add row<ChevronDown size={13}/></button></footer></>}
    </section>
    <input hidden ref={input} type="file" accept=".xlsx,.xls,.csv" onChange={e=>load(e.target.files?.[0])}/>
  </div>
}

function SourcesPanel({onBack}:{onBack:()=>void}){
 return <div className="sources-page"><header><div><small>ORDER CONTROL</small><h1>Connections</h1><p>The systems required to run the NetSuite order workflow end to end.</p></div><button onClick={onBack}>Back to sheet</button></header><div className="source-flow"><span>Email / PO</span><b>→</b><span>NetSuite</span><b>→</b><span>Typeform / Wrike</span><b>→</b><span>S1C</span><b>→</b><span>Sheet</span></div><div className="source-grid">{integrations.map(x=><article key={x.id}><div className="source-title"><span className={`source-logo ${x.id}`}>{x.name.slice(0,1)}</span><div><h2>{x.name}</h2><p>{x.role}</p></div><em className={x.status}>{x.status==="ready"?"Connector ready":x.status==="needs_auth"?"Needs authentication":"Needs API details"}</em></div><dl><div><dt>Connection</dt><dd>{x.method}</dd></div><div><dt>Next requirement</dt><dd>{x.detail}</dd></div></dl><button className={x.status==="ready"?"ready-button":"setup-button"}>{x.status==="ready"?"Test connector":"Configure"}</button></article>)}</div></div>
}

function Section({title,children}:{title:string;children?:React.ReactNode}){return <div className="side-section"><div><span>{title}</span><ChevronDown size={12}/><em><TableProperties size={13}/><FolderPlus size={13}/><Upload size={13}/></em></div>{children}</div>}
function Grid({columns,rows,selected,setSelected}:{columns:string[];rows:Row[];selected:{r:number;c:number}|null;setSelected:(x:{r:number;c:number})=>void}){
 return <div className="grid-wrap"><table><thead><tr><th className="check"><input type="checkbox"/></th>{columns.map(c=><th key={c}><Columns3 size={13}/>{c}</th>)}<th className="add-col"><Plus size={15}/></th></tr></thead><tbody>{rows.length?rows.map((row,r)=><tr key={r}><td className="rownum">{r+1}</td>{columns.map((c,i)=><td onClick={()=>setSelected({r,c:i})} className={selected?.r===r&&selected?.c===i?"selected":""} key={c}>{String(row[c]??"")}</td>)}<td/></tr>):Array.from({length:18},(_,r)=><tr key={r}><td className="rownum">{r+1}</td>{columns.map(c=><td key={c}/>) }<td/></tr>)}</tbody></table></div>
}
