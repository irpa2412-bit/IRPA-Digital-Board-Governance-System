import React, { useMemo, useState } from "react";
import {
  FUNDRAISING_SOURCES, FUNDRAISING_SOURCE_REGIONS, FUNDRAISING_SOURCE_TYPES, searchFundingSources
} from "./fundraising/sourceRegistry.js";

const panel = { border: "1px solid var(--border-color, #344255)", borderRadius: 14, padding: 16, background: "var(--panel-bg, #111c2b)", color: "var(--text-primary, #e8edf5)", display: "grid", gap: 12 };
const input = { width: "100%", minWidth: 0, boxSizing: "border-box", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border-color, #425064)", background: "var(--input-bg, #0b1420)", color: "var(--text-primary, #e8edf5)", fontSize: 14 };
const button = { padding: "8px 10px", borderRadius: 8, border: "1px solid #50727b", background: "transparent", color: "var(--text-primary, #e8edf5)", fontWeight: 700, cursor: "pointer", fontSize: 12 };

export default function FundraisingSourceRegistry({ onResearchSource }) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("all");
  const [type, setType] = useState("all");
  const sources = useMemo(() => searchFundingSources(FUNDRAISING_SOURCES, { query, region, type }), [query, region, type]);

  return <section style={panel} aria-labelledby="fundraising-source-registry-heading">
    <div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.3, textTransform: "uppercase", color: "var(--text-secondary, #aab6c5)" }}>CSR / ESG · FUNDRAISING SOURCE REGISTRY</div>
      <h2 id="fundraising-source-registry-heading" style={{ margin: "5px 0", fontSize: 20 }}>Corporate, climate and partnership sources</h2>
      <p style={{ margin: 0, color: "var(--text-secondary, #aab6c5)", fontSize: 13, lineHeight: 1.55 }}>A curated set of official discovery routes across Tanzania, Africa and international programmes. Filter by geography, support type or focus, then open the issuer's site or use it to seed a live public-web search. A source listing does not mean a current call is open or that IRPA is eligible.</p>
    </div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 9 }}>
      <label style={{ fontSize: 12, fontWeight: 700 }}>Search source, focus or support
        <input aria-label="Search fundraising source registry" style={{ ...input, marginTop: 5 }} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. livestock, CSR, youth, climate" />
      </label>
      <label style={{ fontSize: 12, fontWeight: 700 }}>Geographic scope
        <select aria-label="Filter source registry by geography" style={{ ...input, marginTop: 5 }} value={region} onChange={(event) => setRegion(event.target.value)}>
          <option value="all">All geographies</option>{FUNDRAISING_SOURCE_REGIONS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
      <label style={{ fontSize: 12, fontWeight: 700 }}>Source / support type
        <select aria-label="Filter source registry by type" style={{ ...input, marginTop: 5 }} value={type} onChange={(event) => setType(event.target.value)}>
          <option value="all">All types</option>{FUNDRAISING_SOURCE_TYPES.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </label>
    </div>
    <div aria-live="polite" style={{ color: "var(--text-secondary, #aab6c5)", fontSize: 12 }}>{sources.length} of {FUNDRAISING_SOURCES.length} source routes shown · All records require opportunity-level verification.</div>
    {sources.length === 0 && <div role="status" style={{ border: "1px dashed #425064", borderRadius: 9, padding: 12, fontSize: 13 }}>No sources match these filters. Broaden the search or select all geographies.</div>}
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(245px, 1fr))", gap: 9 }}>
      {sources.map((source) => <article key={source.id} style={{ border: "1px solid var(--border-color, #344255)", borderRadius: 10, padding: 12, display: "grid", alignContent: "start", gap: 7, minWidth: 0 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "start", gap: 8 }}>
          <strong style={{ fontSize: 13, lineHeight: 1.4 }}>{source.name}</strong>
          <span style={{ border: "1px solid #42636d", borderRadius: 999, padding: "3px 7px", fontSize: 10, whiteSpace: "nowrap" }}>{source.region}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-secondary, #aab6c5)" }}>{source.type}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{source.focus.map((item) => <span key={item} style={{ border: "1px solid #425064", borderRadius: 999, padding: "3px 6px", fontSize: 10 }}>{item}</span>)}</div>
        <div style={{ fontSize: 11, color: "var(--text-secondary, #aab6c5)" }}>Potential support: {source.support.join(", ")}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 3 }}>
          <a href={source.url} target="_blank" rel="noopener noreferrer" style={{ ...button, textDecoration: "none", display: "inline-block" }}>Official website ↗</a>
          <button type="button" style={button} onClick={() => onResearchSource?.(source)}>Research funding fit</button>
        </div>
      </article>)}
    </div>
    <p style={{ margin: 0, color: "var(--text-secondary, #aab6c5)", fontSize: 12, lineHeight: 1.5 }}>Status: discovery source only. The portal must verify an actual programme, current deadline or rolling status, Tanzania eligibility, funding terms and application route before classifying any opportunity as actionable. CSR/ESG descriptions are indicative categories, not claims of a published commitment.</p>
  </section>;
}
