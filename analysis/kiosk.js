/* Disc-o-tech — kiosk / leaderboard view. Big, glanceable, gamified.
 * Reuses window.DiscMetrics (parse + analyze) and window.DiscPlot (graphs).
 * Self-contained connection so the main analyzer (app.js) is untouched. */
(function () {
  'use strict';
  const { parseThrows, analyzeThrow } = window.DiscMetrics;
  const $ = id => document.getElementById(id);

  const results = [];                 // { label, m }
  let metric = 'power';               // 'power' (peak g) or 'rpm'

  // ---------- metric helpers ----------
  const metricVal = m => metric === 'power' ? m.peakG : m.rpm;     // may be null for rpm
  const unit = () => metric === 'power' ? 'g' : 'RPM';
  const fmtVal = v => (v == null || isNaN(v)) ? '—' : (metric === 'power' ? v.toFixed(1) : Math.round(v).toString());

  // ---------- render ----------
  function render() {
    const latest = results[results.length - 1];
    // graphs of the newest throw
    if (latest && latest.m.series && latest.m.series.tms.length) {
      const s = latest.m.series, t = s.tms, relX = t.length ? t[s.releaseIdx] : null;
      window.DiscPlot.draw($('accCanvas'), [{ xs: t, ys: s.total, color: '#4fa3ff', label: 'power' }],
        { title: 'acceleration', xlabel: 'ms', releaseX: relX });
      window.DiscPlot.draw($('magCanvas'),
        [{ xs: t, ys: s.mx, color: '#ff7a59', label: 'spin X' }, { xs: t, ys: s.my, color: '#5fd38b', label: 'spin Y' }],
        { title: 'spin', xlabel: 'ms', releaseX: relX });
    }
    // hero number = newest throw's metric
    const v = latest ? metricVal(latest.m) : null;
    $('big').textContent = fmtVal(v);
    $('unit').textContent = unit();
    // bonus line: show the OTHER metric of the newest throw
    if (latest) {
      const rpm = latest.m.rpm, pk = latest.m.peakG;
      $('sub').textContent = metric === 'power'
        ? (rpm != null ? 'spin ' + Math.round(rpm) + ' RPM' : 'spin: too wobbly to read')
        : (pk != null ? 'power ' + pk.toFixed(1) + ' g' : '');
    } else $('sub').textContent = '';
    // session best
    let best = -Infinity;
    results.forEach(r => { const x = metricVal(r.m); if (x != null && x > best) best = x; });
    $('best').textContent = isFinite(best) ? '🏆 best: ' + fmtVal(best) + ' ' + unit() : '🏆 best: —';
    // ranked? no — list is newest-first so the newest + graph stay at the top without scrolling,
    // and we highlight whichever row is the current best.
    const rows = results.map((r, i) => ({ r, i })).reverse();
    $('list').innerHTML = rows.map(({ r, i }) => {
      const x = metricVal(r.m);
      const win = x != null && x === best;
      const time = (r.label || '').replace(/^live /, '');
      return `<div class="item ${win ? 'win' : ''}">` +
        `<span class="rank">#${i + 1}</span>` +
        `<span class="val">${fmtVal(x)} <span class="muted" style="font-size:14px">${unit()}</span></span>` +
        `<span class="meta">${time}${win ? '  · 🏆 best' : ''}</span></div>`;
    }).join('');
  }

  function addThrow(throwObj, label, text) {
    results.push({ label, m: analyzeThrow(throwObj), text: text || '' });
    render();
  }

  $('metric').addEventListener('change', e => { metric = e.target.value; render(); });
  $('reset').addEventListener('click', () => { results.length = 0; render(); });
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
