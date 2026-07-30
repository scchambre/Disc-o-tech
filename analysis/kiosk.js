/* Disc-o-tech — kiosk / leaderboard view. Big, glanceable, gamified.
 * Reuses window.DiscMetrics (parse + analyze) and window.DiscPlot (graphs).
 * Self-contained connection so the main analyzer (app.js) is untouched. */
(function () {
  'use strict';
  const { parseThrows, analyzeThrow } = window.DiscMetrics;
  const $ = id => document.getElementById(id);

  const results = [];                 // { label, m, text }
  let metric = 'power';
  let selectedIdx = null;             // which throw's graphs to show (null = follow newest)

  // ---------- metric config (lower:true means smaller is better — flattest/cleanest) ----------
  const METRICS = {
    power: { get: m => m.peakG,         unit: 'g',   lower: false, dp: 1 },
    rpm:   { get: m => m.rpm,           unit: 'RPM', lower: false, dp: 0 },
    flat:  { get: m => m.flightTiltDeg, unit: '°',   lower: true,  dp: 0 },
    clean: { get: m => m.spinWobbleDeg, unit: '°',   lower: true,  dp: 0 },
  };
  const M = () => METRICS[metric];
  const metricVal = m => M().get(m);
  const unit = () => M().unit;
  const fmtVal = v => (v == null || isNaN(v)) ? '—' : (+v).toFixed(M().dp);
  function bestVal() {
    let best = null;
    results.forEach(r => { const x = metricVal(r.m); if (x == null || isNaN(x)) return; if (best == null || (M().lower ? x < best : x > best)) best = x; });
    return best;
  }

  // ---------- render ----------
  function render() {
    const viewIdx = (selectedIdx != null && selectedIdx >= 0 && selectedIdx < results.length) ? selectedIdx : results.length - 1;
    const view = results[viewIdx];
    // graphs of the VIEWED throw (newest by default, or a past one you clicked)
    if (view && view.m.series && view.m.series.tms.length) {
      const s = view.m.series, t = s.tms, relX = t.length ? t[s.releaseIdx] : null;
      window.DiscPlot.draw($('accCanvas'), [{ xs: t, ys: s.total, color: '#4fa3ff', label: 'power' }],
        { title: 'acceleration', xlabel: 'ms', releaseX: relX });
      window.DiscPlot.draw($('magCanvas'),
        [{ xs: t, ys: s.mx, color: '#ff7a59', label: 'spin X' }, { xs: t, ys: s.my, color: '#5fd38b', label: 'spin Y' }],
        { title: 'spin', xlabel: 'ms', releaseX: relX });
    }
    const v = view ? metricVal(view.m) : null;
    $('big').textContent = fmtVal(v);
    $('unit').textContent = unit();
    if (view) {
      const m = view.m, parts = [];
      if (m.peakG != null) parts.push('power ' + m.peakG.toFixed(1) + 'g');
      if (m.rpm != null) parts.push('spin ' + Math.round(m.rpm) + ' RPM');
      if (m.flightTiltDeg != null) parts.push('flight ' + m.flightTiltDeg.toFixed(0) + '°');
      if (m.spinWobbleDeg != null) parts.push('wobble ' + m.spinWobbleDeg.toFixed(0) + '°');
      $('sub').textContent = parts.join('  ·  ');
    } else $('sub').textContent = '';
    const best = bestVal();
    $('best').textContent = best != null ? '🏆 best: ' + fmtVal(best) + ' ' + unit() : '🏆 best: —';
    const rows = results.map((r, i) => ({ r, i })).reverse();
    $('list').innerHTML = rows.map(({ r, i }) => {
      const x = metricVal(r.m);
      const win = x != null && best != null && x === best;
      const sel = i === viewIdx;
      const time = (r.label || '').replace(/^live /, '');
      return `<div class="item ${win ? 'win' : ''} ${sel ? 'sel' : ''}" data-i="${i}">` +
        `<span class="rank">#${i + 1}</span>` +
        `<span class="val">${fmtVal(x)} <span class="muted" style="font-size:14px">${unit()}</span></span>` +
        `<span class="meta">${time}${win ? '  · 🏆' : ''}${sel ? '  · viewing' : ''}</span></div>`;
    }).join('');
  }

  function addThrow(throwObj, label, text) {
    results.push({ label, m: analyzeThrow(throwObj), text: text || '' });
    selectedIdx = null;     // a fresh throw becomes the focus
    render();
  }

  // click a row to view that throw's graphs (until the next throw arrives)
  $('list').addEventListener('click', e => {
    const item = e.target.closest('.item');
    if (item && item.dataset.i != null) { selectedIdx = +item.dataset.i; render(); }
  });

  $('metric').addEventListener('change', e => { metric = e.target.value; render(); });
  $('reset').addEventListener('click', () => { results.length = 0; selectedIdx = null; render(); });
  // Export every throw as a re-loadable stream file (includes the gravity reference) —
  // drop it back onto the main analyzer, or send it for diagnosis.
  $('export').addEventListener('click', () => {
    if (!results.length) return;
    const text = results.map(r => r.text).filter(Boolean).join('\n') + '\n';
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = 'disc-o-tech-kiosk-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-') + '.csv';
    a.click();
  });

  // ---------- live stream parsing (same protocol as the main analyzer) ----------
  let header = null, curLines = [], curMarker = null, capturing = false;
  function resetStream() { header = null; curLines = []; curMarker = null; capturing = false; }
  function feedLine(line) {
    line = line.trim(); if (!line) return;
    if (line[0] === '#') {
      if (/end/i.test(line) && capturing) { flush(); return; }
      if (capturing) flush();
      curMarker = line; curLines = []; capturing = true; return;
    }
    if (line.split(',').some(c => isNaN(parseFloat(c)))) { header = line; return; }
    if (capturing) curLines.push(line);
  }
  // Mirror live throws across open tabs (kiosk + table at once). One tab connects and
  // broadcasts; others display. Same-origin only — use the https Pages URL for both tabs.
  const bc = (typeof BroadcastChannel !== 'undefined') ? new BroadcastChannel('disc-o-tech-live') : null;
  if (bc) bc.onmessage = e => { try { const t = parseThrows(e.data.text)[0]; if (t) addThrow(t, e.data.label, e.data.text); } catch (_) { } };

  function flush() {
    if (!curLines.length) { capturing = false; return; }
    const text = [curMarker, header, ...curLines].filter(Boolean).join('\n');
    const t = parseThrows(text)[0];
    if (t) {
      const label = 'live ' + new Date().toLocaleTimeString();
      addThrow(t, label, text);
      if (bc) bc.postMessage({ text, label });
    }
    curLines = []; capturing = false;
  }
  const status = m => { $('status').textContent = m; };

  // ---------- Web Serial (USB base station) ----------
  let port, reader, keepReading = false;
  async function connectSerial() {
    if (!('serial' in navigator)) { alert('Use Chrome or Edge for USB.'); return; }
    try { port = await navigator.serial.requestPort(); await port.open({ baudRate: 115200 }); }
    catch (e) { status('could not open port — replug & retry'); return; }
    resetStream(); keepReading = true; status('connected (USB) — throw!');
    $('connect').textContent = 'Disconnect';
    const dec = new TextDecoder(); let buf = '';
    while (port && port.readable && keepReading) {
      reader = port.readable.getReader();
      try {
        while (keepReading) {
          const { value, done } = await reader.read(); if (done) break;
          buf += dec.decode(value, { stream: true });
          let nl; while ((nl = buf.indexOf('\n')) >= 0) { const ln = buf.slice(0, nl); buf = buf.slice(nl + 1); try { feedLine(ln); } catch (e) { } }
        }
      } catch (e) { } finally { try { reader.releaseLock(); } catch (e) { } }
    }
  }
  async function disconnectSerial() {
    keepReading = false;
    try { if (reader) await reader.cancel(); } catch (e) { }
    try { if (port) await port.close(); } catch (e) { }
    port = null; status('disconnected'); $('connect').textContent = 'Connect (USB)';
  }
  $('connect').addEventListener('click', () => keepReading ? disconnectSerial() : connectSerial());

  // ---------- Web Bluetooth (single-board build) ----------
  const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e', NUS_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  $('connectBt').addEventListener('click', async () => {
    if (!navigator.bluetooth) { alert('Use Chrome or Edge for Bluetooth.'); return; }
    try {
      const dev = await navigator.bluetooth.requestDevice({ filters: [{ namePrefix: 'BBC micro:bit' }], optionalServices: [NUS] });
      const ch = await (await (await dev.gatt.connect()).getPrimaryService(NUS)).getCharacteristic(NUS_TX);
      await ch.startNotifications(); resetStream(); status('connected (Bluetooth) — throw!');
      const dec = new TextDecoder(); let buf = '';
      ch.addEventListener('characteristicvaluechanged', e => {
        buf += dec.decode(e.target.value);
        let nl; while ((nl = buf.indexOf('\n')) >= 0) { const ln = buf.slice(0, nl); buf = buf.slice(nl + 1); try { feedLine(ln); } catch (e) { } }
      });
    } catch (e) { if (e.name !== 'NotFoundError') status('bluetooth error'); }
  });

  render();
})();
