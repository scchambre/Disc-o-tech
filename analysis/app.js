/* Disc-o-tech — browser glue: load CSV files OR read the base-station live
 * over Web Serial, analyze each throw, and show a comparison table + plots.
 * No build step. Classic script (works from file://). */
(function () {
  'use strict';
  const { parseThrows, analyzeThrow } = window.DiscMetrics;
  const $ = id => document.getElementById(id);

  const results = [];   // { label, m }
  let throwCounter = 0;

  // ---------- rendering ----------
  const fmt = (v, d = 0) => (v == null || isNaN(v)) ? '—' : (+v).toFixed(d);

  function render() {
    const tb = $('rows'); tb.innerHTML = '';
    results.forEach((r, i) => {
      const m = r.m;
      const tr = document.createElement('tr');
      tr.className = 'pick'; tr.onclick = () => plot(i);
      tr.innerHTML =
        `<td>${r.label}</td><td>${fmt(m.rpm)}</td><td>${fmt(m.releaseTiltDeg, 1)}</td>` +
        `<td>${fmt(m.releaseTiltDirDeg, 0)}</td><td>${fmt(m.peakG, 1)}</td>` +
        `<td>${fmt(m.spinStabilityPct, 1)}</td><td>${fmt(m.sampleRateHz, 0)}</td>` +
        `<td class="${m.warnings.length ? 'warn' : ''}">${m.warnings.length || ''}</td>`;
      tb.appendChild(tr);
    });
    $('count').textContent = results.length;
    if (results.length) plot(results.length - 1);
  }

  function plot(i) {
    const m = results[i].m, s = m.series;
    $('plotTitle').textContent = results[i].label +
      (m.warnings.length ? '  ⚠ ' + m.warnings.join('  ·  ') : '');
    window.DiscPlot.draw($('accCanvas'),
      [{ ys: s.total, color: '#4fa3ff', label: 'accel strength' }],
      { title: 'acceleration', xlabel: 'sample', releaseX: s.releaseIdx });
    window.DiscPlot.draw($('magCanvas'),
      [{ ys: s.mx, color: '#ff7a59', label: 'mag X' }, { ys: s.my, color: '#5fd38b', label: 'mag Y' }],
      { title: 'magnetometer (spin)', xlabel: 'sample', releaseX: s.releaseIdx });
  }

  function addThrow(throwObj, labelHint) {
    const m = analyzeThrow(throwObj);
    throwCounter++;
    results.push({ label: labelHint || ('throw ' + throwCounter), m });
    render();
  }

  // ---------- file / drag-drop ----------
  function loadText(text, srcName) {
    const throwsArr = parseThrows(text);
    if (!throwsArr.length) { alert('No data rows found in ' + srcName); return; }
    throwsArr.forEach((t, i) =>
      addThrow(t, throwsArr.length > 1 ? `${srcName} #${i + 1}` : srcName));
  }
  function handleFiles(files) {
    [...files].forEach(f => { const r = new FileReader(); r.onload = () => loadText(r.result, f.name); r.readAsText(f); });
  }
  $('file').addEventListener('change', e => handleFiles(e.target.files));
  const drop = $('drop');
  ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => handleFiles(e.dataTransfer.files));

  // ---------- Web Serial (live from base station) ----------
  let port, reader, keepReading = false;
  let header = null, curLines = [], curMarker = null, capturing = false;

  function resetStream() { header = null; curLines = []; curMarker = null; capturing = false; }

  function feedLine(line) {
    line = line.trim(); if (!line) return;
    if (line[0] === '#') {
      if (/end/i.test(line) && capturing) { flush(); return; }
      // a new "# throw" marker
      if (capturing) flush();
      curMarker = line; curLines = []; capturing = true; return;
    }
    const looksHeader = line.split(',').some(c => isNaN(parseFloat(c)));
    if (looksHeader) { header = line; return; }
    if (capturing) curLines.push(line);
  }
  function flush() {
    if (!curLines.length) { capturing = false; return; }
    const text = [curMarker, header, ...curLines].filter(Boolean).join('\n');
    const t = parseThrows(text)[0];
    if (t) addThrow(t, 'live ' + new Date().toLocaleTimeString());
    curLines = []; capturing = false;
  }

  async function connect() {
    if (!('serial' in navigator)) { alert('Web Serial needs Chrome or Edge (and https:// or file://).'); return; }
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
      resetStream();
      $('connect').textContent = 'Disconnect';
      keepReading = true;
      const dec = new TextDecoderStream();
      port.readable.pipeTo(dec.writable).catch(() => { });
      reader = dec.readable.getReader();
      let buf = '';
      while (keepReading) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += value;
        let nl; while ((nl = buf.indexOf('\n')) >= 0) { feedLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      }
    } catch (e) { console.error(e); }
  }
  async function disconnect() {
    keepReading = false;
    try { if (reader) await reader.cancel(); } catch (e) { }
    try { if (port) await port.close(); } catch (e) { }
    $('connect').textContent = 'Connect base station';
  }
  $('connect').addEventListener('click', () => (keepReading ? disconnect() : connect()));

  // ---------- Web Bluetooth (single-board build) ----------
  const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';      // micro:bit UART service
  const NUS_TX = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';   // micro:bit -> browser (notify)
  let btDevice = null;

  async function connectBluetooth() {
    if (!navigator.bluetooth) {
      alert('Web Bluetooth needs Chrome or Edge on desktop, with system Bluetooth turned on.'); return;
    }
    try {
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ namePrefix: 'BBC micro:bit' }],
        optionalServices: [NUS]
      });
      btDevice = device;
      device.addEventListener('gattserverdisconnected', onBtDisconnect);
      const server = await device.gatt.connect();
      const ch = await (await server.getPrimaryService(NUS)).getCharacteristic(NUS_TX);
      await ch.startNotifications();
      resetStream();
      const dec = new TextDecoder();
      let buf = '';
      ch.addEventListener('characteristicvaluechanged', e => {
        buf += dec.decode(e.target.value);
        let nl; while ((nl = buf.indexOf('\n')) >= 0) { feedLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
      });
      $('connectBt').textContent = 'Disconnect Bluetooth';
    } catch (e) {
      console.error(e);
      if (e.name !== 'NotFoundError') alert('Bluetooth error: ' + e.message);  // NotFoundError = user cancelled picker
    }
  }
  function onBtDisconnect() { $('connectBt').textContent = 'Connect via Bluetooth'; btDevice = null; }
  $('connectBt').addEventListener('click', () => {
    if (btDevice && btDevice.gatt.connected) btDevice.gatt.disconnect();
    else connectBluetooth();
  });

  // ---------- export ----------
  $('export').addEventListener('click', () => {
    if (!results.length) return;
    const head = 'label,rpm,release_tilt_deg,tilt_dir_deg,peak_g,spin_stability_pct,sample_rate_hz,warnings';
    const lines = results.map(r => {
      const m = r.m;
      return [r.label, fmt(m.rpm), fmt(m.releaseTiltDeg, 1), fmt(m.releaseTiltDirDeg, 0),
      fmt(m.peakG, 1), fmt(m.spinStabilityPct, 1), fmt(m.sampleRateHz, 0),
      '"' + m.warnings.join(' | ') + '"'].join(',');
    });
    const blob = new Blob([[head, ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'disc-o-tech-results.csv'; a.click();
  });
  $('clear').addEventListener('click', () => { results.length = 0; throwCounter = 0; render(); });

  render();
})();
