import { useState } from "react";
import {
  ArrowRight, Boxes, ChevronDown, Cloud, Code2, GitBranch, Globe2,
  Menu, ShieldCheck, X,
} from "lucide-react";

export default function App() {
  const [menuOpen, setMenuOpen] = useState(false);

  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
    setMenuOpen(false);
  };

  return (
    <main>
      <nav className="nav shell" aria-label="Main navigation">
        <button className="brand" onClick={() => scrollTo("top")} aria-label="opentabs home">
          <span className="asterisk">✳</span> opentabs
        </button>
        <div className={`nav-links ${menuOpen ? "open" : ""}`}>
          <button onClick={() => scrollTo("product")}>Product</button>
          <button onClick={() => scrollTo("how")}>Pricing</button>
          <button onClick={() => scrollTo("top")}>Resources <ChevronDown size={13}/></button>
          <button onClick={() => scrollTo("open-source")}>Updates</button>
          <button onClick={() => scrollTo("contact")}>Contact</button>
        </div>
        <div className="nav-actions">
          <button className="language"><Globe2 size={15}/> English</button>
          <a className="text-link" href="https://github.com" target="_blank" rel="noreferrer">Log in</a>
          <button className="pill dark small" onClick={() => scrollTo("top")}>Get started</button>
          <button className="menu" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">{menuOpen ? <X /> : <Menu />}</button>
        </div>
      </nav>

      <section className="hero shell" id="top">
        <div className="hero-grid">
          <div className="hero-left">
            <h1>Build your company’s<br /><span>software stack</span></h1>
            <div className="hero-actions">
              <button className="pill dark" onClick={() => scrollTo("top")}>Start building</button>
              <button className="pill light" onClick={() => window.location.href = "mailto:hello@opentabs.dev"}>Contact sales</button>
            </div>
          </div>
          <div className="hero-copy">
            <p>opentabs is the trusted production environment for software built by your team and AI agents. Deploy behind company login, approve changes, manage connections, and know when anything needs attention.</p>
          </div>
        </div>

        <div className="trust-row">
          <strong>GitHub</strong><strong>Google Workspace</strong><strong>Microsoft Entra</strong>
          <strong>Salesforce</strong><strong>NetSuite</strong><strong>Slack</strong>
        </div>

        <ControlPlane />
      </section>
    </main>
  );
}

function ControlPlane() {
  return <div className="product-frame" aria-label="opentabs control plane preview">
    <div className="frame-top"><span className="mini-brand"><i /><i /><i /></span><strong>opentabs</strong><div className="frame-search">⌕ Search company apps</div><span className="live-dot">● All systems normal</span><div className="avatar">DA</div></div>
    <aside><button className="active"><Boxes /> App directory</button><button><Cloud /> Connections</button><button><GitBranch /> Approvals</button><button><ShieldCheck /> Access & audit</button><div className="aside-bottom"><Code2 /> Invite IT <ArrowRight /></div></aside>
    <div className="workspace">
      <header><div><small>ACME COMPANY</small><h3>Company software</h3></div><button>+ Add an app</button></header>
      <div className="metrics"><div><span>Live apps</span><strong>24</strong><em>+3 this month</em></div><div><span>Running well</span><strong>23</strong><em>96% healthy</em></div><div><span>Awaiting approval</span><strong>1</strong><em>Review change →</em></div></div>
      <div className="table-card">
        <div className="table-title"><strong>All internal apps</strong><span>Filter <ChevronDown /></span></div>
        {[["Order control","Operations","Company login","Healthy"],["Vendor onboarding","Finance","3 connections","Healthy"],["Campaign approvals","Marketing","Change pending","Review"],["Support triage","Customer success","Company login","Healthy"]].map(r => <div className="deployment-row" key={r[0]}><span className="customer-icon">{r[0][0]}</span><strong>{r[0]}</strong><span>{r[1]}</span><span>{r[2]}</span><em className={r[3] === 'Healthy' ? 'healthy' : 'update'}>{r[3]}</em><b>•••</b></div>)}
      </div>
    </div>
  </div>;
}
