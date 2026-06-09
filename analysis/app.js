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
  const compass = d => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round((((d % 360) + 360) % 360) / 45) % 8];
  const norm180 = d => (((d + 180) % 360) + 360) % 360 - 180;   // wrap to -180..180
  const throwLineDeg = () => parseFloat(($('throwLine') || {}).value) || 0;

  function render() {
    const tb = $('rows'); tb.innerHTML = '';
    const tl = throwLineDeg();
    results.forEach((r, i) => {
      const m = r.m;
      const lean = m.flightLeanBearingDeg;
      const cardCell = lean == null ? '—' : Math.round(lean) + '° ' + compass(lean);
      const relCell = lean == null ? '—' : (norm180(lean - tl) > 0 ? '+' : '') + Math.round(norm180(lean - tl)) + '°';
      const tr = document.createElement('tr');
      tr.className = 'pick'; tr.onclick = () => plot(i);
      tr.innerHTML =
        `<td>${r.label}</td><td>${fmt(m.rpm)}</td><td>${fmt(m.releaseTiltDeg, 1)}</td>` +
        `<td>${fmt(m.flightTiltDeg, 1)}</td><td>${cardCell}</td><td>${relCell}</td><td>${fmt(m.peakG, 1)}</td>` +
        `<td>${fmt(m.spinWobbleDeg, 1)}</td><td>${fmt(m.sampleRateHz, 0)}</td>` +
        `<td class="${m.warnings.length ? 'warn' : ''}" title="${m.warnings.join(' · ').replace(/"/g, "'")}">${m.warnings.length || ''}</td>`;
      tb.appendChild(tr);
    });
    $('count').textContent = results.length;
    if (results.length) plot(results.length - 1);
  }

  function plot(i) {
    const m = results[i].m, s = m.series;
    const t = s.tms || [];
    const relX = t.length ? t[s.releaseIdx] : null;   // release marker at its TIME, not index
    $('plotTitle').textContent = results[i].label +
      (m.warnings.length ? '  ⚠ ' + m.warnings.join('  ·  ') : '');
    window.DiscPlot.draw($('accCanvas'),
      [{ xs: t, ys: s.total, color: '#4fa3ff', label: 'accel strength' }],
      { title: 'acceleration', xlabel: 'time (ms)', releaseX: relX });
    window.DiscPlot.draw($('magCanvas'),
      [{ xs: t, ys: s.mx, color: '#ff7a59', label: 'mag X' }, { xs: t, ys: s.my, color: '#5fd38b', label: 'mag Y' }],
      { title: 'magnetometer (spin)', xlabel: 'time (ms)', releaseX: relX });
  }

  function addThrow(throwObj, labelHint) {
    const m = analyzeThrow(throwObj);
    throwCounter++;
    results.push({ label: labelHint || ('throw ' + throwCounter), m, samples: throwObj.samples || [] });
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
    if (!('serial' in navigator)) { alert('Web Serial needs Chrome or Edge.'); return; }
    try {
      port = await navigator.serial.requestPort();
      await port.open({ baudRate: 115200 });
    } catch (e) {
      console.error(e);
      alert('Could not open the port. If you just refreshed the page, unplug and replug the base station, then try Connect again.');
      return;
    }
    resetStream();
    $('connect').textContent = 'Disconnect';
    keepReading = true;
    const decoder = new TextDecoder();
    let buf = '';
    // Resilient read loop: re-acquire the reader if a read errors (a USB hiccup
    // used to kill the old pipeTo loop permanently), and never let one bad line
    // stop the stream — that's why only the first throw used to come through.
    while (port && port.readable && keepReading) {
      reader = port.readable.getReader();
      try {
        while (keepReading) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let nl;
          while ((nl = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
            try { feedLine(line); } catch (err) { console.error('parse error (skipped)', err); }
          }
        }
      } catch (e) {
        console.error('serial read error — re-acquiring', e);
      } finally {
        try { reader.releaseLock(); } catch (e) { }
      }
    }
  }
  async function disconnect() {
    keepReading = false;
    try { if (reader) await reader.cancel(); } catch (e) { }
    try { if (reader) reader.releaseLock(); } catch (e) { }
    try { if (port) await port.close(); } catch (e) { }
    port = null;
    $('connect').textContent = 'USB base station (2 boards)';
  }
  $('connect').addEventListener('click', () => (keepReading ? disconnect() : connect()));

  // ---------- Web Bluetooth (single-board build) ----------
  const NUS = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';      // micro:bit UART service
  // micro:bit's TX characteristic (the board NOTIFIES data out on this one).
  // NOTE: the micro:bit swaps TX/RX vs the Nordic standard — its notify channel
  // is …0002 (…0003 is the write channel and can't notify → "GATT not supported").
  const NUS_TX = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
  let btDevice = null;          // currently connected device
  let lastGoodDevice = null;    // last micro:bit that worked (same-session reconnect)
  let btAttempts = 0;           // count of failed picks this hunt
  const btStatus = msg => { ['btStatus', 'btStatus2'].forEach(id => { const el = $(id); if (el) el.textContent = msg; }); };
  const withTimeout = (p, ms, label) => Promise.race([
    p, new Promise((_, rej) => setTimeout(() => rej(new Error(label + ' timed out')), ms))
  ]);
  // NOTE: Web Bluetooth hides the MAC address from the page for privacy, so we
  // cannot show/label the address you see in the picker — hence the C/D/E/F tip.

  // shared: connect to a chosen device, wire up notifications, remember it
  async function connectToDevice(device) {
    btStatus('⏳ Connecting…');
    device.addEventListener('gattserverdisconnected', onBtDisconnect);
    const server = await withTimeout(device.gatt.connect(), 8000, 'Connect');
    const service = await withTimeout(server.getPrimaryService(NUS), 6000, 'Service lookup');
    const ch = await withTimeout(service.getCharacteristic(NUS_TX), 6000, 'Characteristic');
    await ch.startNotifications();
    resetStream();
    const dec = new TextDecoder(); let buf = '';
    ch.addEventListener('characteristicvaluechanged', e => {
      buf += dec.decode(e.target.value);
      let nl; while ((nl = buf.indexOf('\n')) >= 0) { feedLine(buf.slice(0, nl)); buf = buf.slice(nl + 1); }
    });
    btDevice = device; lastGoodDevice = device;
    try { localStorage.setItem('discBtId', device.id); } catch (_) { }
    btAttempts = 0;             // hunt is over
    btStatus('✅ Connected to your micro:bit — throw away! ⚡ Reconnect works the rest of this session.');
    $('connectBt').textContent = 'Disconnect Bluetooth';
  }

  // Pick from the chooser. filterByName=true uses the same name filter the official
  // createai tool uses, so ONLY "BBC micro:bit […]" appears — no address hunting.
  // Otherwise show-all (then use the C/D/E/F address rule). Wrong picks auto-forget.
  async function pick(filterByName) {
    if (!navigator.bluetooth) { alert('Web Bluetooth needs Chrome or Edge on desktop, Bluetooth on.'); return; }
    let device;
    try {
      device = await navigator.bluetooth.requestDevice(
        filterByName ? { filters: [{ namePrefix: 'BBC micro:bit' }], optionalServices: [NUS] }
          : { acceptAllDevices: true, optionalServices: [NUS] });
    } catch (e) { return; }   // user closed the picker / nothing matched the filter
    try {
      await connectToDevice(device);
    } catch (e) {
      console.error('Bluetooth connect failed:', e);
      try { device.gatt.disconnect(); } catch (_) { }
      if (typeof device.forget === 'function') { try { await device.forget(); } catch (_) { } }
      btAttempts++;
      btStatus('❌ Connect failed: ' + (e.message || e) + '  —  if you picked the micro:bit BY NAME, its ' +
        'UART channel is not answering, so it is probably still running createai firmware. Re-flash the ' +
        'combo code (LED should show two top corners) and close the createai tab.');
    }
  }

  // Reconnect with no picker: reuse the in-memory device (same session, no flag
  // needed); else the remembered device via getDevices (needs the Chrome flag).
  async function reconnectBluetooth() {
    if (lastGoodDevice) {
      try { await connectToDevice(lastGoodDevice); return; } catch (e) { }
    }
    if (navigator.bluetooth && navigator.bluetooth.getDevices) {
      let devices = [];
      try { devices = await navigator.bluetooth.getDevices(); } catch (_) { }
      let savedId = null; try { savedId = localStorage.getItem('discBtId'); } catch (_) { }
      const device = devices.find(d => d.id === savedId) || devices[0];
      if (device) { try { await connectToDevice(device); return; } catch (e) { } }
    }
    btStatus('No remembered micro:bit yet — do one connect first. (Reconnect across page reloads ' +
      'needs chrome://flags/#enable-web-bluetooth-new-permissions-backend enabled.)');
  }

  function onBtDisconnect() {
    $('connectBt').textContent = 'Bluetooth · show all'; btDevice = null;
    btStatus('Disconnected. ⚡ Reconnect last to get back on.');
  }
  $('connectBt').addEventListener('click', () => {
    if (btDevice && btDevice.gatt.connected) btDevice.gatt.disconnect();
    else pick(false);
  });
  if ($('connectBtFilter')) $('connectBtFilter').addEventListener('click', () => pick(true));
  if ($('connectBtFilter2')) $('connectBtFilter2').addEventListener('click', () => pick(true));
  if ($('reconnectBt')) $('reconnectBt').addEventListener('click', reconnectBluetooth);
  if ($('throwLine')) $('throwLine').addEventListener('input', render);
  if ($('flipLine')) $('flipLine').addEventListener('click', () => {
    const el = $('throwLine'); el.value = ((((parseFloat(el.value) || 0) + 180) % 360) + 360) % 360; render();
  });

  // ---------- export ----------
  $('export').addEventListener('click', () => {
    if (!results.length) return;
    const tl = throwLineDeg();
    const head = 'label,rpm,reach_tilt_deg,flight_tilt_deg,lean_bearing_deg,lean_vs_throw_deg,peak_g,spin_wobble_deg,sample_rate_hz,warnings';
    const lines = results.map(r => {
      const m = r.m, lean = m.flightLeanBearingDeg;
      return [r.label, fmt(m.rpm), fmt(m.releaseTiltDeg, 1), fmt(m.flightTiltDeg, 1),
      (lean == null ? '' : fmt(lean, 0)), (lean == null ? '' : fmt(norm180(lean - tl), 0)),
      fmt(m.peakG, 1), fmt(m.spinWobbleDeg, 1), fmt(m.sampleRateHz, 0),
      '"' + m.warnings.join(' | ') + '"'].join(',');
    });
    downloadCsv([head, ...lines].join('\n'), 'disc-o-tech-results.csv');
  });

  // Export EVERY raw sample of every throw (for graphing in other software).
  $('exportRaw').addEventListener('click', () => {
    if (!results.length) return;
    const v = x => (x == null || isNaN(x)) ? '' : x;
    const rows = ['throw,t_ms,x,y,z,total,mx,my'];
    results.forEach(r => (r.samples || []).forEach(s =>
      rows.push(['"' + String(r.label).replace(/"/g, '""') + '"',
        v(s.t), v(s.x), v(s.y), v(s.z), v(s.total), v(s.mx), v(s.my)].join(','))));
    downloadCsv(rows.join('\n'), 'disc-o-tech-raw.csv');
  });

  function downloadCsv(text, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }));
    a.download = name; a.click();
  }
  $('clear').addEventListener('click', () => { results.length = 0; throwCounter = 0; render(); });

  render();
})();
