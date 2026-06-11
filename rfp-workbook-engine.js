// rfp-workbook-engine.js — extraction, Claude pipeline, and XLSX writing for the RFP Workbook Creator.
// Exposes window.RfpEngine = { run(file, ui) } — ui: {log(kind,msg), claude(msg), done(blob,name,summary), error(msg), progress(pct,label)}
(function(){
  'use strict';

  /* ---------------- text extraction ---------------- */
  async function extractPdf(buf){
    const lib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.min.mjs');
    lib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.0.379/build/pdf.worker.min.mjs';
    const doc = await lib.getDocument({data:new Uint8Array(buf)}).promise;
    let out='';
    const n = Math.min(doc.numPages, 150);
    for(let i=1;i<=n;i++){
      const tc = await (await doc.getPage(i)).getTextContent();
      out += '\n[page '+i+'] ' + tc.items.map(it=>it.str).join(' ');
      if(out.length > 280000) break;
    }
    return out;
  }
  async function extractDocx(buf){
    const b=new Uint8Array(buf);
    const u32=o=>b[o]|(b[o+1]<<8)|(b[o+2]<<16)|(b[o+3]<<24);
    const u16=o=>b[o]|(b[o+1]<<8);
    for(let i=0;i+4<b.length;i++){
      if(b[i]!==0x50||b[i+1]!==0x4b||b[i+2]!==0x03||b[i+3]!==0x04) continue;
      const nameLen=u16(i+26), extraLen=u16(i+28);
      const name=new TextDecoder().decode(b.slice(i+30,i+30+nameLen));
      if(name!=='word/document.xml') continue;
      const comp=u16(i+8), size=u32(i+18);
      const data=b.slice(i+30+nameLen+extraLen, i+30+nameLen+extraLen+size);
      let xml;
      if(comp===0){ xml=new TextDecoder().decode(data); }
      else { xml=await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text(); }
      return xml.replace(/<w:p[ >]/g,'\n<w:p ').replace(/<[^>]+>/g,' ').replace(/[ \t]+/g,' ');
    }
    throw new Error('Could not read this .docx file');
  }
  async function extractText(file){
    const name=file.name.toLowerCase();
    if(name.endsWith('.pdf')) return extractPdf(await file.arrayBuffer());
    if(name.endsWith('.docx')) return extractDocx(await file.arrayBuffer());
    return file.text();
  }

  /* ---------------- xlsx editing ---------------- */
  const NSS='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  function colLetters(ref){ return ref.replace(/[0-9]+$/,''); }
  function rowNum(ref){ return Number(ref.replace(/^[A-Z]+/,'')); }
  function colNum(l){ let n=0; for(const ch of l) n=n*26+(ch.charCodeAt(0)-64); return n; }

  function parseSheet(files, n){
    const xml=new TextDecoder().decode(files['xl/worksheets/sheet'+n+'.xml']);
    return new DOMParser().parseFromString(xml,'application/xml');
  }
  function saveSheet(files, n, doc){
    files['xl/worksheets/sheet'+n+'.xml'] = new TextEncoder().encode(new XMLSerializer().serializeToString(doc));
  }
  function getRow(doc, r, create){
    const sd=doc.getElementsByTagName('sheetData')[0];
    const rows=[...sd.getElementsByTagName('row')];
    let row=rows.find(x=>Number(x.getAttribute('r'))===r);
    if(row||!create) return row||null;
    row=doc.createElementNS(NSS,'row');
    row.setAttribute('r',String(r));
    const after=rows.find(x=>Number(x.getAttribute('r'))>r);
    sd.insertBefore(row, after||null);
    return row;
  }
  function setCell(doc, ref, value){
    const r=rowNum(ref);
    const row=getRow(doc,r,true);
    const cells=[...row.getElementsByTagName('c')];
    let c=cells.find(x=>x.getAttribute('r')===ref);
    if(!c){
      c=doc.createElementNS(NSS,'c');
      c.setAttribute('r',ref);
      const after=cells.find(x=>colNum(colLetters(x.getAttribute('r')))>colNum(colLetters(ref)));
      row.insertBefore(c, after||null);
    }
    while(c.firstChild) c.removeChild(c.firstChild);
    if(value===''||value==null){ c.removeAttribute('t'); return; }
    c.setAttribute('t','inlineStr');
    const is=doc.createElementNS(NSS,'is');
    const t=doc.createElementNS(NSS,'t');
    t.setAttribute('xml:space','preserve');
    t.textContent=String(value);
    is.appendChild(t); c.appendChild(is);
    return c;
  }
  // Insert k rows after row `anchor`, cloning anchor's cell styles into each new row; shift everything below.
  function insertRows(doc, anchor, k){
    if(k<=0) return;
    const sd=doc.getElementsByTagName('sheetData')[0];
    const rows=[...sd.getElementsByTagName('row')];
    // shift rows below anchor
    rows.filter(x=>Number(x.getAttribute('r'))>anchor).forEach(x=>{
      const nr=Number(x.getAttribute('r'))+k;
      x.setAttribute('r',String(nr));
      [...x.getElementsByTagName('c')].forEach(c=>{
        c.setAttribute('r', colLetters(c.getAttribute('r'))+nr);
      });
    });
    // clone anchor row k times
    const aRow=rows.find(x=>Number(x.getAttribute('r'))===anchor);
    let ins=aRow ? aRow.nextSibling : null;
    for(let i=1;i<=k;i++){
      const nr=anchor+i;
      const row=doc.createElementNS(NSS,'row');
      row.setAttribute('r',String(nr));
      if(aRow && aRow.getAttribute('ht')){ row.setAttribute('ht',aRow.getAttribute('ht')); row.setAttribute('customHeight','1'); }
      if(aRow){[...aRow.getElementsByTagName('c')].forEach(c0=>{
        const c=doc.createElementNS(NSS,'c');
        c.setAttribute('r', colLetters(c0.getAttribute('r'))+nr);
        if(c0.getAttribute('s')) c.setAttribute('s', c0.getAttribute('s'));
        row.appendChild(c);
      });}
      sd.insertBefore(row, ins);
    }
    // shift merged cells fully below anchor
    const mc=doc.getElementsByTagName('mergeCells')[0];
    if(mc){[...mc.getElementsByTagName('mergeCell')].forEach(m=>{
      const ref=m.getAttribute('ref').split(':');
      const r1=rowNum(ref[0]), r2=rowNum(ref[1]);
      if(r1>anchor) m.setAttribute('ref', colLetters(ref[0])+(r1+k)+':'+colLetters(ref[1])+(r2+k));
    });}
    // shift DV + CF ranges that start below or span the anchor area
    [...doc.getElementsByTagName('dataValidation')].forEach(d=>{
      d.setAttribute('sqref', shiftRange(d.getAttribute('sqref'), anchor, k));
    });
    [...doc.getElementsByTagName('conditionalFormatting')].forEach(d=>{
      d.setAttribute('sqref', shiftRange(d.getAttribute('sqref'), anchor, k));
    });
  }
  function shiftRange(sq, anchor, k){
    return sq.split(' ').map(part=>{
      const bits=part.split(':');
      const out=bits.map(b=>{
        const r=rowNum(b);
        return r>anchor ? colLetters(b)+(r+k) : b;
      });
      // extend range END if range spans the anchor (grow the table zone)
      if(bits.length===2){
        const r1=rowNum(bits[0]), r2=rowNum(bits[1]);
        if(r1<=anchor && r2>=anchor) out[1]=colLetters(bits[1])+(r2+k);
      }
      return out.join(':');
    }).join(' ');
  }
  function extendTable(files, tableFile, k){
    if(k<=0) return;
    const dec=new TextDecoder();
    let xml=dec.decode(files[tableFile]);
    xml=xml.replace(/ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g, (m,c1,r1,c2,r2)=>'ref="'+c1+r1+':'+c2+(Number(r2)+k)+'"');
    files[tableFile]=new TextEncoder().encode(xml);
  }
  function extendFilterAndDims(files, k){
    if(k<=0) return;
    const dec=new TextDecoder();
    let wb=dec.decode(files['xl/workbook.xml']);
    wb=wb.replace(/(\$A\$3:\$J\$)(\d+)/, (m,p,r)=>p+(Number(r)+k));
    files['xl/workbook.xml']=new TextEncoder().encode(wb);
  }

  /* ---------------- Claude prompts ---------------- */
  const ACCURACY='RULES: Only state what the RFP actually says; never guess or fill from general knowledge. Copy dates, dollar figures, deadlines and quantities verbatim; state the currency. Cite RFP section/page numbers in Notes where practical. Addenda override the base document. Where the RFP is silent on bonds, permits, insurance, warranty, price hold or lead time, write "Not specified in RFP". Cells you do not mention stay as-is.\nJSON: Respond with ONLY valid minified JSON, no markdown fences, no commentary. Escape line breaks inside strings as \\n. Be thorough and specific like a senior bid analyst: complete informative values (up to 380 characters each), verbatim figures, section references in Notes columns. A sparse workbook is a failed workbook — if the digest has relevant facts, use them. Put unused template row numbers in "clearRows" (array of numbers) instead of writing empty strings.';

  function R(rfp){ return 'RFP DOCUMENT TEXT:\n"""\n'+rfp+'\n"""\n\n'; }

  // Tolerant JSON extraction
  function parseLoose(raw){
    let s=String(raw).replace(/```(json)?/gi,'');
    const start=s.indexOf('{');
    if(start<0) throw new Error('no JSON in response');
    let depth=0,end=-1,inStr=false,esc=false;
    for(let i=start;i<s.length;i++){
      const ch=s[i];
      if(inStr){ if(esc) esc=false; else if(ch==='\\') esc=true; else if(ch==='"') inStr=false; }
      else { if(ch==='"') inStr=true; else if(ch==='{') depth++; else if(ch==='}'){ depth--; if(depth===0){ end=i; break; } } }
    }
    if(end<0) throw new Error('truncated JSON');
    s=s.slice(start,end+1);
    try{ return JSON.parse(s); }
    catch(e){
      let out='',inS=false,e2=false;
      for(const ch of s){
        if(inS){
          if(e2){ out+=ch; e2=false; continue; }
          if(ch==='\\'){ out+=ch; e2=true; continue; }
          if(ch==='"'){ inS=false; out+=ch; continue; }
          if(ch==='\n'){ out+='\\n'; continue; }
          if(ch==='\r'){ continue; }
          if(ch==='\t'){ out+='\\t'; continue; }
          out+=ch;
        } else { if(ch==='"') inS=true; out+=ch; }
      }
      return JSON.parse(out);
    }
  }
  // Recover complete "REF":"value" pairs from a truncated reply
  function salvage(raw){
    const writes={};
    const re=/"([A-Z]{1,2}\d{1,3})"\s*:\s*"((?:[^"\\\n\r]|\\.)*)"/g;
    let m,c=0;
    while((m=re.exec(raw))){ try{ writes[m[1]]=JSON.parse('"'+m[2]+'"'); c++; }catch(e){} }
    if(!c) return null;
    const out={writes,_salvaged:c};
    const rm=raw.match(/"rows"\s*:\s*(\d+)/); if(rm) out.rows=Number(rm[1]);
    const nm=raw.match(/"names"\s*:\s*\[([^\]]*)\]/);
    if(nm){ try{ out.names=JSON.parse('['+nm[1]+']'); }catch(e){} }
    const crm=raw.match(/"clearRows"\s*:\s*\[([^\]]*)\]/);
    if(crm){ out.clearRows=crm[1].split(',').map(x=>Number(x.trim())).filter(Number.isFinite); }
    return out;
  }

  const STRICT='\n\nREMINDER: reply with VALID minified JSON only, escape line breaks inside strings as \\n, nothing outside the JSON object.';
  const SIZE_STEPS=[1,1,0.6,0.6,0.35]; // same-size retries first (transient stalls), then shrink
  function isStall(msg){ return /no data|timeout|timed out|network|fetch|aborted/i.test(msg); }
  async function ask(ui, label, rfp, base, promptFn, opts){
    opts=opts||{};
    const tries=opts.tries||5, backoff=opts.backoff||1500;
    let strict='', lastErr;
    for(let a=0;a<tries;a++){
      try{
        const factor=SIZE_STEPS[Math.min(a,SIZE_STEPS.length-1)];
        const slice=rfp.slice(0, Math.round(base*factor));
        const raw=await window.claude.complete(promptFn(slice)+strict);
        try{ return parseLoose(raw); }
        catch(pe){
          const sv=salvage(raw);
          if(sv){ ui.log('warn', label+': reply was cut short — recovered '+sv._salvaged+' values.'); return sv; }
          strict=STRICT; throw pe;
        }
      }catch(err){
        lastErr=err;
        const m=err.message||'error';
        if(a<tries-1){
          // stalls often mean the relay needs a cooldown — back off harder each time
          const wait = isStall(m) ? Math.min(45000, backoff*Math.pow(2,a)) : backoff;
          if(isStall(m)) ui.log('sys', label+': Claude is taking a while to respond — waiting '+Math.round(wait/1000)+'s before retry ('+(a+2)+'/'+tries+')…');
          else ui.log('warn', label+': '+m+' — retrying ('+(a+2)+'/'+tries+')…');
          await new Promise(r=>setTimeout(r, wait));
        }
      }
    }
    const lm=(lastErr&&lastErr.message)||'failed';
    throw new Error(label+': '+lm+(isStall(lm)?' — the AI connection never started streaming after '+tries+' attempts. Refresh the page and try again.':''));
  }

  /* ---------------- main pipeline ---------------- */
  async function run(file, ui){
    const t0=Date.now();
    const elapsed=()=>{ const sec=Math.round((Date.now()-t0)/1000); return sec<120? sec+'s' : Math.floor(sec/60)+'m '+(sec%60)+'s'; };
    const pause=()=>new Promise(r=>setTimeout(r,700));

    ui.progress(2,'Reading document');
    ui.log('sys','Reading \u201c'+file.name+'\u201d ('+Math.round(file.size/1024)+' KB)\u2026');
    let rfp = (await extractText(file)).replace(/[ \t]+/g,' ').trim();
    if(!rfp || rfp.length<400) throw new Error('Couldn\'t extract enough text from this file \u2014 is it a scanned/image-only PDF?');
    const fullLen=rfp.length;
    rfp = rfp.slice(0,240000);
    ui.log('sys','Extracted '+fullLen.toLocaleString()+' characters. This will be a thorough read \u2014 expect 5\u201310 minutes for a full RFP.');

    ui.progress(5,'Loading template');
    const fflate = await import('https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js');
    const resp = await fetch('RFP_Analysis_Workbook_TEMPLATE.xlsx');
    if(!resp.ok) throw new Error('Template file missing \u2014 RFP_Analysis_Workbook_TEMPLATE.xlsx must sit next to this page.');
    const files = fflate.unzipSync(new Uint8Array(await resp.arrayBuffer()));
    ui.log('sys','Blank workbook template loaded (7 tabs). Editing the real file \u2014 formatting stays intact.');

    ui.progress(7,'Connecting to Claude');
    ui.claude('Connecting \u2014 the first response can take a minute or two\u2026');
    await ask(ui,'Connection', '', 0, ()=>'Reply with exactly this JSON and nothing else: {"ok":1}', {tries:8, backoff:3000});
    ui.claude('Connected. Reading the full document\u2026');

    /* ----- STAGE 1: digest every chunk of the document ----- */
    const CH=9000, chunks=[];
    for(let i=0;i<rfp.length && chunks.length<28;i+=CH) chunks.push(rfp.slice(i, i+CH+400));
    const facts=[];
    for(let i=0;i<chunks.length;i++){
      const c=chunks[i];
      const pm=c.match(/\[page (\d+)\]/g);
      const pr=pm&&pm.length?(' \u00b7 pages '+pm[0].replace(/\D/g,'')+'\u2013'+pm[pm.length-1].replace(/\D/g,'')):'';
      ui.progress(8+Math.round(((i+1)/chunks.length)*34),'Reading the document ('+(i+1)+'/'+chunks.length+')');
      ui.claude('Reading part '+(i+1)+' of '+chunks.length+pr+'\u2026');
      const res=await ask(ui,'Reading part '+(i+1), c, c.length, sl=>'You are reading part '+(i+1)+' of '+chunks.length+' of an RFP document, extracting facts for Kompan\'s bid-analysis workbook.\nEXCERPT:\n"""\n'+sl+'\n"""\nExtract EVERY fact in this excerpt relevant to bidding: RFP identity, agency, dates, addenda; deadlines (verbatim, with times and timezones); submission method, portal rules, contacts; budgets and ALL dollar figures (verbatim); scope, site, location; design / equipment / age groups / surfacing / accessibility requirements; mandatory or excluded materials and components; standards and certifications; engineering and stamped-drawing requirements; bonds, insurance, permits, warranty, maintenance, lead time; pricing rules and taxes; evaluation criteria with EXACT weights, points and minimum thresholds; mandatory submission items and proposal format/page limits; restrictive language (sole-source, "or approved equal", named competitor products); legal or contract terms that affect the bid decision. Quote every number verbatim. End each fact with its section/page reference in parentheses. Skip pure boilerplate. Nothing relevant \u2192 {"facts":[]}.\nJSON only: {"facts":["fact (s.X.Y / p.N)"]}');
      (res.facts||[]).forEach(f=>{ if(typeof f==='string'&&f.trim()) facts.push(f.trim().slice(0,300)); });
      await pause();
    }
    ui.log('sys',facts.length+' facts extracted from the full document.');
    if(facts.length<5) throw new Error('Could not extract meaningful content from this document.');

    let digest=facts.map(f=>'- '+f).join('\n');
    if(digest.length>24000){
      ui.claude('Consolidating '+facts.length+' facts into a working brief\u2026');
      try{
        const res=await ask(ui,'Consolidate', digest, 24000, sl=>'Below are facts extracted from an RFP. Deduplicate and consolidate to at most 160 facts. KEEP every verbatim figure, date, weight, threshold and section reference. Drop only true duplicates and irrelevant trivia.\nFACTS:\n"""\n'+sl+'\n"""\nJSON only: {"facts":["..."]}');
        if(res.facts&&res.facts.length>10) digest=res.facts.map(f=>'- '+String(f).slice(0,300)).join('\n');
      }catch(e){ digest=digest.slice(0,24000); }
      await pause();
    }

    /* ----- STAGE 2: populate tabs from the full-document digest ----- */
    const BASE=digest.length;
    const D=sl=>'FACT DIGEST extracted from the FULL RFP document (section references in parentheses):\n"""\n'+sl+'\n"""\n\n';
    let rfpNumber='', stepNo=0;
    const tick=(label)=>{ stepNo++; ui.progress(Math.min(88, 44+Math.round((stepNo/13)*44)), label); };

    function applyTo(doc, cols, res){
      let n=0;
      const writes=res.writes||{};
      for(const ref in writes){
        if(!/^[A-Z]{1,2}[0-9]{1,3}$/.test(ref)) continue;
        setCell(doc, ref, writes[ref]); n++;
      }
      if(Array.isArray(res.clearRows)&&cols){
        res.clearRows.forEach(r=>{
          const rn=Number(r);
          if(rn>=4&&rn<=60&&Number.isFinite(rn)) cols.forEach(c=>setCell(doc,c+rn,''));
        });
      }
      return n;
    }

    /* TAB 1 */
    let doc=parseSheet(files,1), n=0;
    tick('TAB 1 \u2014 RFP Summary');
    ui.claude('TAB 1 \u00b7 core RFP facts\u2026');
    const t1a=await ask(ui,'TAB 1a',digest,BASE,sl=>D(sl)+'Fill TAB 1 (RFP Summary) part 1 of Kompan\'s workbook. Write Value to column B and Notes (with section refs) to column C: row5 RFP Name, row6 RFP Number, row7 Issuing Agency, row8 Issue Date, row9 first Addendum (also rewrite A9, e.g. "Addendum No. 1"; none issued \u2192 B9="None to date" with the source in C9 and add 10 to clearRows), row10 second Addendum (rewrite A10), row11 Question Deadline (verbatim), row12 Proposal Due Date (verbatim, time + timezone), row13 Submission Method (portal, account requirements), row14 Submission Recipients, row15 Primary Point of Contact (name + email), row16 Secondary Point of Contact.\nAlso A1: "<PROJECT NAME> \u2014 RFP ANALYSIS WORKBOOK" (caps). A2: "<RFP No.>  \u00b7  <Client/Agency>  \u00b7  Vendor: Kompan".\n'+ACCURACY+'\nShape: {"writes":{"A1":"...","B5":"..."},"clearRows":[]}');
    n+=applyTo(doc,['A','B','C'],t1a);
    rfpNumber=((t1a.writes||{}).B6||'').toString().trim();
    await pause();
    ui.claude('TAB 1 \u00b7 budgets, scope, critical reminders\u2026');
    const t1b=await ask(ui,'TAB 1b',digest,BASE,sl=>D(sl)+'Fill TAB 1 (RFP Summary) part 2 of Kompan\'s workbook. Write Value to B and Notes (with section refs) to C: row18 Funding Source, row19 Total Equipment Budget (verbatim, note if HARD cap and tax treatment), row20 Surfacing Budget, row21 Price Hold Period, row22 Playground Area (size), row23 Number of Designs Required, row24 High-Level Scope (full sentence: demolition? supply? install? ages?), row25 Contract Path (direct vs subcontract; single-entity rules), row26 Lead Time Cap, row27 Project Location. Row 17 is the Kompan contact \u2014 skip.\nThen A30..A36: the SEVEN most critical deal-breakers, each starting with "\u2022  ": hard caps, minimum threshold scores, domestic-content rules, mandatory standards (CSA/ASTM/IPEMA), excluded materials/components, mandatory design content, pricing rules. Most important first; fewer than 7 \u2192 leftover row numbers in clearRows.\n'+ACCURACY+'\nShape: {"writes":{"B18":"...","A30":"..."},"clearRows":[]}');
    n+=applyTo(doc,['A','B','C'],t1b);
    saveSheet(files,1,doc);
    ui.claude('TAB 1 \u2014 RFP Summary done: '+n+' cells. ['+elapsed()+']');
    await pause();

    /* TAB 2 */
    doc=parseSheet(files,2); n=0;
    tick('TAB 2 \u2014 Design Details');
    ui.claude('TAB 2 \u00b7 design & theme requirements\u2026');
    n+=applyTo(doc,['A','B','C','D'],await ask(ui,'TAB 2a',digest,BASE,sl=>D(sl)+'Fill the design-category table (rows 5-17) on TAB 2 of Kompan\'s workbook. Per row: A=category label (rename to fit this RFP), B=Specification (full detail), C=Notes/Source (section refs), D=Status (exactly one of: Required, Mandatory, Optional, Open, Info). Template rows: 5 Thematic Inspiration, 6 Aesthetic, 7 Sensory Integration, 8 Accessibility Standard, 9 Inclusive Design, 10 Play Value, 11 Primary Landmark, 12 Main Structure Material, 13 Material Quality, 14 Excluded Components, 15 Surfacing, 16 Site Conditions, 17 Standards & Certifications. Use every relevant digest fact; unused rows \u2192 clearRows.\n'+ACCURACY+'\nShape: {"writes":{"B5":"..."},"clearRows":[]}'));
    await pause();
    ui.claude('TAB 2 \u00b7 senior equipment\u2026');
    n+=applyTo(doc,['A','B','C','D'],await ask(ui,'TAB 2b',digest,BASE,sl=>D(sl)+'Fill the SENIOR equipment table (rows 21-28) on TAB 2 of Kompan\'s playground workbook. A19 header: rewrite with the RFP\'s senior age range, format "\ud83c\udf33  SENIOR-FOCUSED EQUIPMENT  \u00b7  Ages <X \u2013 Y>". Rows 21-28: A=Element (rename to the RFP\'s actual required elements; template: Play Structure(s), Transfer Station(s), Slides, Swings, Sand Play, Activity Panels, Overhead Element, Free-standing Elements), B=Requirement/Minimum (verbatim quantities), C=Notes (refs), D=Status. Unused rows \u2192 clearRows. Not a playground RFP \u2192 repurpose for actual scope.\n'+ACCURACY+'\nShape: {"writes":{"A19":"...","B21":"..."},"clearRows":[]}'));
    await pause();
    ui.claude('TAB 2 \u00b7 junior equipment\u2026');
    n+=applyTo(doc,['A','B','C','D'],await ask(ui,'TAB 2c',digest,BASE,sl=>D(sl)+'Fill the JUNIOR equipment table (rows 32-41) on TAB 2 of Kompan\'s playground workbook. A30 header: rewrite with the RFP\'s junior age range, format "\ud83c\udf31  JUNIOR-FOCUSED EQUIPMENT  \u00b7  Ages <X \u2013 Y>". Rows 32-41: A=Element (rename to the RFP\'s actual required elements; template: Standalone Junior Structure, Transfer Station(s), Slides, Horizontal Turning Bar, Balance Elements, Crawl Tunnels, Activity Panels, Ground-level Climbing, Ground-level Movement, Tot Swings), B=Requirement/Minimum, C=Notes, D=Status. If the RFP has ONE combined age range, repurpose this table for additional required elements/amenities and rename A30. Unused rows \u2192 clearRows.\n'+ACCURACY+'\nShape: {"writes":{"A30":"...","B32":"..."},"clearRows":[]}'));
    saveSheet(files,2,doc);
    ui.claude('TAB 2 \u2014 Design Details done: '+n+' cells. ['+elapsed()+']');
    await pause();

    /* TAB 3 */
    doc=parseSheet(files,3); n=0;
    tick('TAB 3 \u2014 Quoting Details');
    ui.claude('TAB 3 \u00b7 commercial terms\u2026');
    n+=applyTo(doc,['B','C'],await ask(ui,'TAB 3a',digest,BASE,sl=>D(sl)+'Fill TAB 3 (Quoting Details) rows 4-13 of Kompan\'s workbook. Per row: B=RFP Requirement (quote exact language for money/tax rules), C=Notes/Vendor Action (refs). Rows: 4 Currency, 5 Budget Cap, 6 Pricing Inclusions (taxes in/out \u2014 exact words), 7 Price Hold, 8 Alternate/Provisional Pricing, 9 Surfacing, 10 Site Work/Demolition, 11 Lead Time, 12 Installer Experience, 13 Installation Vehicles.\n'+ACCURACY+'\nShape: {"writes":{"B4":"..."},"clearRows":[]}'));
    await pause();
    ui.claude('TAB 3 \u00b7 bonds, warranty & engineering\u2026');
    n+=applyTo(doc,['B','C'],await ask(ui,'TAB 3b',digest,BASE,sl=>D(sl)+'Fill TAB 3 (Quoting Details) rows 14-22 + engineering block of Kompan\'s workbook. Per row: B=RFP Requirement, C=Notes/Vendor Action (refs). Rows: 14 Bonds, 15 Permits, 16 Stamped Drawings, 17 Site Inspections, 18 Warranty, 19 Maintenance/Parts, 20 Sustainability Inputs, 21 Building Code, 22 Assumptions & Exclusions. Silent on bonds/permits/warranty/price-hold/lead-time \u2192 "Not specified in RFP".\nA24 header: "\ud83d\udd27  ENGINEERING & CERTIFICATION \u2014 <licensing body/jurisdiction>". Rows 25-29 column B ONLY: 25 Engineered Stamped Shop Drawings, 26 Site Inspections, 27 Footings & Shelter Certification, 28 Building Permit Documentation, 29 Professional Standing.\n'+ACCURACY+'\nShape: {"writes":{"B14":"...","A24":"..."},"clearRows":[]}'));
    saveSheet(files,3,doc);
    ui.claude('TAB 3 \u2014 Quoting Details done: '+n+' cells. ['+elapsed()+']');
    await pause();

    /* TAB 4 */
    doc=parseSheet(files,4); n=0;
    tick('TAB 4 \u2014 Compliance Matrix');
    ui.claude('TAB 4 \u00b7 planning the compliance rows\u2026');
    const plan=await ask(ui,'TAB 4 plan',digest,BASE,sl=>D(sl)+'Plan TAB 4 (Compliance Matrix) of Kompan\'s workbook: ONE row per submission requirement or evaluated deliverable in this RFP \u2014 be comprehensive, including mandatory forms, attestations, certifications, design deliverables, schedule artifacts, references, insurance and bonding (max 28, most important first). Also list the literal required-submission checklist items (max 10).\n'+ACCURACY+'\nShape: {"names":["requirement"],"checklist":["item"]}');
    const names=(plan.names||[]).slice(0,28).map(x=>String(x).slice(0,90));
    if(!names.length) throw new Error('TAB 4: could not identify submission requirements.');
    const rowsTotal=names.length;
    const k4=Math.max(0, rowsTotal-20);
    if(k4>0){
      insertRows(doc, 23, k4);
      const af=doc.getElementsByTagName('autoFilter')[0];
      if(af) af.setAttribute('ref', shiftRange(af.getAttribute('ref'), 22, k4));
      extendFilterAndDims(files, k4);
    }
    ui.claude('TAB 4 \u00b7 '+rowsTotal+' requirements identified. Detailing\u2026');
    await pause();
    for(let b=0;b<rowsTotal;b+=5){
      const batch=names.slice(b,b+5);
      const startRow=4+b;
      ui.claude('TAB 4 \u00b7 rows '+startRow+'\u2013'+(startRow+batch.length-1)+'\u2026');
      const det=await ask(ui,'TAB 4 rows '+startRow,digest,BASE,sl=>D(sl)+'Fill TAB 4 (Compliance Matrix) rows '+startRow+'-'+(startRow+batch.length-1)+' of Kompan\'s workbook \u2014 one row per requirement, in this order:\n'+batch.map((x,i)=>'row'+(startRow+i)+': '+x).join('\n')+'\nColumns per row: A=Requirement Name, B=Underlying Task (what Kompan must do), C=Task Requirements (cite RFP sections), D=Category (Design/Pricing/Technical/Schedule/Quality/Sustainability/Administrative), E=What must be submitted, F=Suggested response strategy for Kompan (specific, actionable), G="Open", H=Owner ("" unless obvious: Design/B&P/Engineering/Operations/Pricing), I=Due Date (1-3 business days before the deadline, as text), J=Notes.\n'+ACCURACY+'\nShape: {"writes":{"A'+startRow+'":"..."}}');
      n+=applyTo(doc,null,det);
      await pause();
    }
    if(rowsTotal<20) for(let r=4+rowsTotal;r<=23;r++) ['A','B','C','D','E','F','G','H','I','J'].forEach(c=>setCell(doc,c+r,''));
    const ckBase=26+k4;
    const checklist=(plan.checklist||[]).slice(0,10);
    checklist.forEach((item,i)=>setCell(doc,'A'+(ckBase+i),'\u2610  '+String(item).slice(0,160)));
    for(let r=ckBase+checklist.length;r<=ckBase+9;r++) setCell(doc,'A'+r,'');
    n+=checklist.length;
    saveSheet(files,4,doc);
    ui.claude('TAB 4 \u2014 Compliance Matrix done: '+rowsTotal+' requirements, '+checklist.length+' checklist items. ['+elapsed()+']');
    await pause();

    /* TAB 5 */
    doc=parseSheet(files,5); n=0;
    tick('TAB 5 \u2014 Evaluation Criteria');
    ui.claude('TAB 5 \u00b7 how the client scores\u2026');
    const t5=await ask(ui,'TAB 5',digest,BASE,sl=>D(sl)+'Fill TAB 5 (Evaluation Criteria) of Kompan\'s workbook. Criteria rows start at row 4 (template holds 3: rows 4-6). Per criterion: A="(a) Name", "(b) Name"\u2026, B=exact weight INCLUDING any minimum threshold (e.g. "60 pts \u2014 minimum threshold 48"), C=the indicators/sub-criteria as "\u2022 " items separated by \\n. Give "rows": total criteria count (max 10). If rows>3 the block below shifts down by rows-3 \u2014 use SHIFTED refs. Scoring structure (template rows 9-12): A9/B9/C9 non-price subtotal, A10/B10/C10 thresholds/gates, A11/B11/C11 price component and formula, B12 TOTAL with C12 explaining how stages combine and tie-breakers. Strategic takeaway (template A14): "\ud83d\udca1  Strategic takeaway: <one line \u2014 where the points are and where Kompan must invest>". No published criteria \u2192 rows=3, A4="Not specified in RFP", clearRows [5,6].\n'+ACCURACY+'\nShape: {"rows":N,"writes":{"A4":"..."},"clearRows":[]}');
    if(t5.rows>3){
      const k=Math.min(t5.rows,10)-3;
      insertRows(doc,6,k);
      extendTable(files,'xl/tables/table6.xml',k);
    }
    n+=applyTo(doc,['A','B','C'],t5);
    saveSheet(files,5,doc);
    ui.claude('TAB 5 \u2014 Evaluation Criteria done: '+n+' cells. ['+elapsed()+']');
    await pause();

    /* TAB 6 */
    doc=parseSheet(files,6); n=0;
    tick('TAB 6 \u2014 Proposal Format');
    ui.claude('TAB 6 \u00b7 submission structure\u2026');
    n+=applyTo(doc,['A','B'],await ask(ui,'TAB 6',digest,BASE,sl=>D(sl)+'Fill TAB 6 (Proposal Format) rows 4-16 of Kompan\'s workbook. A=Section title (numbered "1. ", "2. "\u2026), B=what it must contain per THIS RFP including page limits and mandatory content (refs). If the RFP mandates a structure, mirror it EXACTLY in order; otherwise adapt the default 13 sections (Cover Letter; Design Narrative; Design Package \u2014 Concept A; Design Package \u2014 Concept B if required; Engineering & Certifications; Installation Plan; Materials, Warranty & Maintenance; Sustainability Statement; Schedule & Lead Time; Pricing; Assumptions & Exclusions; References/Past Performance; Appendices). Renumber sequentially. Unused rows \u2192 clearRows.\n'+ACCURACY+'\nShape: {"writes":{"A4":"..."},"clearRows":[]}'));
    saveSheet(files,6,doc);
    ui.claude('TAB 6 \u2014 Proposal Format done: '+n+' cells. ['+elapsed()+']');
    await pause();

    /* TAB 7 */
    doc=parseSheet(files,7); n=0;
    tick('TAB 7 \u2014 Win Strategies');
    ui.claude('TAB 7 \u00b7 win strategies\u2026');
    n+=applyTo(doc,['A','B','C'],await ask(ui,'TAB 7',digest,BASE,sl=>D(sl)+'Fill TAB 7 (Win Strategies) rows 4-16 of Kompan\'s workbook. A=Strategy Area (replace bracketed placeholders with project-specific angles; keep applicable named areas: Inclusive Design Leadership, Multi-Sensory Play, High Play-Event Density, Engineering Capacity, Lead-Time Reliability, Warranty Depth, Ease of Maintenance, Sustainability Credentials, Local Presence, Municipal Track Record), B=the Kompan advantage stated specifically for THIS RFP, C=Evaluation Tie-in citing the SPECIFIC criterion, weight and threshold it serves. Ground claims in what the RFP rewards \u2014 do not invent capabilities. Unused rows \u2192 clearRows.\nA1: "WIN STRATEGIES  \u00b7  KOMPAN Differentiators for <RFP No.>". A18: \ud83c\udfaf  Win theme:  "<one sentence>".\n'+ACCURACY+'\nShape: {"writes":{"A1":"...","A4":"..."},"clearRows":[]}'));
    saveSheet(files,7,doc);
    ui.claude('TAB 7 \u2014 Win Strategies done: '+n+' cells. ['+elapsed()+']');

    const dec=new TextDecoder();
    ui.progress(90,'Final checks');
    ui.claude('Verifying: placeholders cleared, statuses valid, tables intact\u2026');
    let leftovers=0;
    for(let sh=1;sh<=7;sh++){
      const xml=dec.decode(files['xl/worksheets/sheet'+sh+'.xml']);
      const m=xml.match(/\[[A-Za-z][^\]<>{}]{2,60}\]/g);
      if(m) leftovers+=m.length;
    }
    if(leftovers>0) ui.log('warn',leftovers+' template placeholder(s) may remain (the RFP likely didn\'t cover those fields). Review before sending.');

    ui.progress(96,'Packaging workbook');
    const out = fflate.zipSync(files, {level:6});
    try{
      const check = fflate.unzipSync(out);
      for(let sh=1;sh<=7;sh++){
        const d=new DOMParser().parseFromString(new TextDecoder().decode(check['xl/worksheets/sheet'+sh+'.xml']),'application/xml');
        if(d.getElementsByTagName('parsererror').length) throw new Error('sheet'+sh+' failed to re-parse');
      }
      ui.log('sys','Smoke test passed \u2014 workbook re-opens cleanly, all 7 sheets valid.');
    }catch(e){ throw new Error('Output verification failed: '+e.message); }
    const blob = new Blob([out], {type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
    const safeNum = (rfpNumber||'RFP').replace(/[^A-Za-z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,60)||'RFP';
    const fname = safeNum+'_RFP_Analysis_Workbook.xlsx';

    let summary='';
    try{
      ui.claude('Writing the handoff summary\u2026');
      summary = await window.claude.complete('Based on these facts extracted from an RFP, give a summary for Kompan\'s B&P team in under 150 words: project name, client, proposal due date, budget, top 3 deal-breakers, and anything ambiguous needing human follow-up. Plain text, short lines, no markdown.\n\nFACTS:\n"""\n'+digest.slice(0,12000)+'\n"""');
    }catch(e){ summary='(Summary unavailable \u2014 workbook still completed.)'; }

    ui.progress(100,'Done');
    ui.done(blob, fname, summary, elapsed());
  }

  window.RfpEngine = { run };
})();
