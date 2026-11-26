(function () {
  // AES-256-GCM Decryption & PIN Gate (PIN: 2410)
  async function decryptPayloadWithPin(pinStr) {
    if (!window.ENCRYPTED_CONTABILITA_B64) return null;
    try {
      const enc = new TextEncoder();
      const dec = new TextDecoder();
      const keyMaterial = await crypto.subtle.importKey(
        'raw', enc.encode(pinStr), { name: 'PBKDF2' }, false, ['deriveKey']
      );
      const key = await crypto.subtle.deriveKey(
        {
          name: 'PBKDF2',
          salt: enc.encode('GiuseppeAnello2026_Salt'),
          iterations: 100000,
          hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['decrypt']
      );
      const rawBin = atob(window.ENCRYPTED_CONTABILITA_B64);
      const cipherBytes = new Uint8Array(rawBin.length);
      for (let i = 0; i < rawBin.length; i++) cipherBytes[i] = rawBin.charCodeAt(i);
      const plainBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: enc.encode('GA2026_IV12B') },
        key,
        cipherBytes
      );
      return JSON.parse(dec.decode(plainBuf));
    } catch (e) {
      return null;
    }
  }

  async function initPersonalPinGate() {
    const gate = document.getElementById('personalPinGate');
    if (!gate) return;
    const PIN_STORE = 'contabilita_ga_pin_v1';
    const savedPin = localStorage.getItem(PIN_STORE);

    async function tryUnlock(pinVal) {
      const unlockedData = await decryptPayloadWithPin(pinVal);
      if (!unlockedData) return false;
      localStorage.setItem(PIN_STORE, pinVal);
      gate.style.display = 'none';
      if (!state.data || !state.data.categories || state.data.categories.length === 0) {
        state.data = unlockedData;
        ensureDataIntegrity();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
        initYearSelector();
        renderAll();
        syncWithServerOnStartup();
      }
      return true;
    }

    if (savedPin) {
      const ok = await tryUnlock(savedPin);
      if (ok) return;
    }

    const form = document.getElementById('personalPinForm');
    const inp = document.getElementById('personalPinInput');
    const err = document.getElementById('personalPinError');
    if (form) {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const ok = await tryUnlock((inp.value || '').trim());
        if (!ok) {
          err.style.display = 'block';
          inp.value = '';
          inp.focus();
        }
      });
    }
  }

  const STORAGE_KEY = 'contabilita_giuseppe_anello_v2';
  const STYLE_KEY = 'contabilita_style_v2';

  const MONTHS = [
    { idx: 0, short: 'Gen', full: 'Gennaio' },
    { idx: 1, short: 'Feb', full: 'Febbraio' },
    { idx: 2, short: 'Mar', full: 'Marzo' },
    { idx: 3, short: 'Apr', full: 'Aprile' },
    { idx: 4, short: 'Mag', full: 'Maggio' },
    { idx: 5, short: 'Giu', full: 'Giugno' },
    { idx: 6, short: 'Lug', full: 'Luglio' },
    { idx: 7, short: 'Ago', full: 'Agosto' },
    { idx: 8, short: 'Set', full: 'Settembre' },
    { idx: 9, short: 'Ott', full: 'Ottobre' },
    { idx: 10, short: 'Nov', full: 'Novembre' },
    { idx: 11, short: 'Dic', full: 'Dicembre' }
  ];

  const DEFAULT_NEEDS_SET = new Set([
    'Condominio',
    'Luce',
    'Gas',
    'Acqua',
    'Spesa',
    'Pulizia+Manutenzione',
    'Internet/Telefono',
    'Assicurazione',
    'Mezzi Pubblici',
    'Tasse',
    'Benzina',
    'Spese Mediche'
  ]);

  const QUICK_EXPENSE_CATS = [
    'Spesa',
    'Benzina',
    'Uscite A Cena Fuori',
    'Spese Mediche',
    'Amazon',
    'Sfizi',
    'Luce',
    'Gas',
    'Condominio',
    'Pulizia+Manutenzione'
  ];

  let state = {
    data: null,
    selectedYear: 2026,
    selectedMonth: 10, // Default Novembre (index 10)
    txMonthFilter: 10,
    activeView: 'monthly', // 'monthly', 'annual', 'transactions', 'taxes', 'budget', 'categories', 'backup'
    monthlyType: 'REDDITO',
    annualType: 'REDDITO',
    budgetType: 'REDDITO',
    catType: 'REDDITO',
    txModalType: 'SPESE',
    quickCat: 'Spesa',
    showQuickBar: true,
    showNeedsBox: false
  };

  function ensureDataIntegrity() {
    if (!Array.isArray(state.data.invoices)) {
      state.data.invoices = [];
    }
    if (!state.data.taxSettings || state.data.taxSettings.f24JuneTotal === undefined) {
      // Scomposizione REALE dai PDF F24 (22/06/2026 e 30/11/2026)
      state.data.taxSettings = {
        coeff: 86,
        irpefRate: 5,
        inpsRate: 26.07,
        june: { inps: 907.23, imposta: 152.50, saldoPrev: 379.00, credito: 148.00 },
        nov: { inps: 907.24, imposta: 152.50 }
      };
    }
    // Apply sensible Needs vs Wants defaults if only 1 expense had flag=true from Excel
    const expCats = state.data.categories.filter((c) => c.type === 'SPESE');
    const flaggedCount = expCats.filter((c) => c.flag === true).length;
    if (flaggedCount <= 1 && !state.data.needsInitialized) {
      expCats.forEach((c) => {
        c.flag = DEFAULT_NEEDS_SET.has(c.name);
      });
      state.data.needsInitialized = true;
    }
  }

  function updateSyncBadge(status, text) {
    const b = document.getElementById('syncStatusBadge');
    if (!b) return;
    if (status === 'synced') {
      b.textContent = text || '🟢 Sync PC + D: OK';
      b.style.borderColor = 'var(--income)';
      b.style.color = 'var(--income)';
    } else if (status === 'local') {
      b.textContent = text || '📱 Memoria Locale (Offline)';
      b.style.borderColor = 'var(--debt)';
      b.style.color = 'var(--debt)';
    } else {
      b.textContent = text || '🔄 Sincronizzazione...';
    }
  }

  function loadData() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.categories) && Array.isArray(parsed.transactions)) {
          state.data = parsed;
          ensureDataIntegrity();
          return;
        }
      }
    } catch (e) {
      console.error('Errore lettura localStorage:', e);
    }
    state.data = JSON.parse(JSON.stringify(window.DEFAULT_CONTABILITA_DATA));
    ensureDataIntegrity();
    saveData(false);
  }

  const HOME_PC_API = 'http://192.168.1.131:8095/api/data';

  function getApiUrl() {
    if (location.hostname === 'localhost' || location.hostname === '127.0.0.1' || location.hostname.startsWith('192.168.')) {
      return '/api/data';
    }
    return HOME_PC_API;
  }

  function countUserRecords(d) {
    if (!d) return 0;
    const txLen = Array.isArray(d.transactions) ? d.transactions.length : 0;
    const invLen = Array.isArray(d.invoices) ? d.invoices.length : 0;
    return txLen + invLen * 10; // weight invoices strongly so a dataset with invoices is never overwritten by one with 0 invoices
  }

  async function syncWithServerOnStartup() {
    if (location.protocol === 'file:') {
      updateSyncBadge('local', '💻 File Locale');
      return;
    }
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2200);
      const res = await fetch(getApiUrl(), { cache: 'no-store', signal: controller.signal });
      clearTimeout(timeoutId);
      if (!res.ok) throw new Error('No API');
      const serverData = await res.json();
      if (!serverData || !Array.isArray(serverData.transactions)) return;

      const localInvLen = state.data && Array.isArray(state.data.invoices) ? state.data.invoices.length : 0;
      const serverInvLen = Array.isArray(serverData.invoices) ? serverData.invoices.length : 0;
      const localScore = countUserRecords(state.data);
      const serverScore = countUserRecords(serverData);

      const localTime = state.data && state.data.exportedAt ? new Date(state.data.exportedAt).getTime() : 0;
      const serverTime = serverData.exportedAt ? new Date(serverData.exportedAt).getTime() : 0;

      // Never overwrite local invoices with an empty server invoice list!
      if (localInvLen > serverInvLen || localScore > serverScore || (localScore === serverScore && localTime > serverTime)) {
        await pushDataToServer();
      } else {
        state.data = serverData;
        ensureDataIntegrity();
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
        initYearSelector();
        renderAll();
        updateSyncBadge('synced', '🟢 Sync Casa (J: + D:)');
      }
    } catch (e) {
      updateSyncBadge('local', '📱 Autonomo (Memoria Telefono)');
    }
  }

  async function pushDataToServer() {
    if (location.protocol === 'file:') return;
    try {
      updateSyncBadge('syncing', '🔄 Sync PC...');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 2200);
      const res = await fetch(getApiUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(state.data),
        signal: controller.signal
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        updateSyncBadge('synced', '🟢 Sync Casa (J: + D:)');
      } else {
        updateSyncBadge('local', '📱 Autonomo (Memoria Telefono)');
      }
    } catch (e) {
      updateSyncBadge('local', '📱 Autonomo (Memoria Telefono)');
    }
  }

  function saveData(showNotification = false) {
    try {
      state.data.exportedAt = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
      pushDataToServer();
      if (showNotification) showToast('✅ Salvato su Telefono + PC (J: e D:)');
    } catch (e) {
      console.error('Errore salvataggio localStorage:', e);
      showToast('⚠️ Errore salvataggio memoria');
    }
  }

  function showToast(msg) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.style.display = 'block';
    clearTimeout(t._timer);
    t._timer = setTimeout(() => {
      t.style.display = 'none';
    }, 2400);
  }

  function fmtEuro(val) {
    const num = Number(val) || 0;
    return num.toLocaleString('it-IT', { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + ' €';
  }

  function fmtPct(val) {
    if (!isFinite(val)) return '0%';
    return Math.round(val * 100) + '%';
  }

  function getCategoryMap() {
    const map = {};
    state.data.categories.forEach((c) => {
      map[c.type + '::' + c.name] = c;
    });
    return map;
  }

  function getTransactionsFor(monthOrAll) {
    return state.data.transactions.filter((tx) => {
      if (!tx.date) return false;
      const y = parseInt(tx.date.slice(0, 4), 10);
      const m = parseInt(tx.date.slice(5, 7), 10) - 1;
      if (y !== state.selectedYear) return false;
      if (monthOrAll !== 'ALL' && m !== monthOrAll) return false;
      return true;
    });
  }

  function getCatBudgetFor(cat, monthOrAll) {
    if (!cat || !Array.isArray(cat.budget)) return 0;
    if (monthOrAll === 'ALL') {
      return cat.budget.reduce((acc, v) => acc + (Number(v) || 0), 0);
    }
    return Number(cat.budget[monthOrAll]) || 0;
  }

  function computeTotalsFor(monthOrAll) {
    const txs = getTransactionsFor(monthOrAll);
    const types = ['REDDITO', 'SPESE', 'RISPARMI', 'DEBITI'];
    const result = {};

    types.forEach((tp) => {
      const cats = state.data.categories.filter((c) => c.type === tp);
      const budgetTotal = cats.reduce((s, c) => s + getCatBudgetFor(c, monthOrAll), 0);
      const actualTotal = txs
        .filter((t) => t.type === tp)
        .reduce((s, t) => s + (Number(t.amount) || 0), 0);
      result[tp] = {
        budget: budgetTotal,
        actual: actualTotal,
        diff: actualTotal - budgetTotal,
        pct: budgetTotal > 0 ? actualTotal / budgetTotal : 0
      };
    });

    return result;
  }

  // Build SVG Donut Ring
  function buildDonutGaugeSvg(pct, colorStr) {
    const clamped = Math.min(1, Math.max(0, pct || 0));
    const r = 20;
    const c = 2 * Math.PI * r;
    const offset = c * (1 - clamped);
    const pctText = Math.round((pct || 0) * 100) + '%';

    return `
      <div class="donut-ring">
        <svg viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="${r}" fill="none" stroke="var(--bg-elevated)" stroke-width="5.5" />
          <circle cx="25" cy="25" r="${r}" fill="none" stroke="${colorStr}" stroke-width="5.5"
            stroke-dasharray="${c.toFixed(1)}" stroke-dashoffset="${offset.toFixed(1)}" stroke-linecap="round" />
        </svg>
        <span class="donut-ring-text" style="color:${colorStr};">${pctText}</span>
      </div>
    `;
  }

  function buildKpiGridHtml(totals) {
    const kpiConfig = [
      { type: 'REDDITO', label: '💶 REDDITO', color: 'var(--income)' },
      { type: 'SPESE', label: '🛒 SPESE', color: 'var(--expense)' },
      { type: 'RISPARMI', label: '🐖 RISPARMI', color: 'var(--savings)' },
      { type: 'DEBITI', label: '💳 DEBITI', color: 'var(--debt)' }
    ];

    return kpiConfig
      .map((cfg) => {
        const t = totals[cfg.type];
        const diffAbs = Math.abs(t.diff);
        let diffText = '✅ Obiettivo raggiunto';
        if (t.diff > 0.01) diffText = `⬆️ ${fmtEuro(diffAbs)} sopra al budget`;
        else if (t.diff < -0.01) diffText = `⬇️ ${fmtEuro(diffAbs)} sotto al budget`;

        return `
        <div class="kpi-card">
          <div class="kpi-top-row">
            <div>
              <div class="kpi-label">${cfg.label}</div>
              <div class="kpi-value" style="color:${cfg.color};">${fmtEuro(t.actual)}</div>
            </div>
            ${buildDonutGaugeSvg(t.pct, cfg.color)}
          </div>
          <div class="kpi-sub" style="margin-top:4px;">
            Budget: <b>${fmtEuro(t.budget)}</b>
          </div>
          <div class="kpi-sub" style="margin-top:2px; font-weight:700;">
            ${diffText}
          </div>
        </div>
      `;
      })
      .join('');
  }

  // Render Quick Expense Bar (Tastiera Rapida Spese Frequenti)
  function renderQuickExpenseBar() {
    const bar = document.getElementById('quickCatsBar');
    if (!bar) return;
    const catMap = getCategoryMap();

    bar.innerHTML = QUICK_EXPENSE_CATS.map((cName) => {
      const cat = catMap['SPESE::' + cName];
      const icon = cat ? cat.icon : '🛒';
      const active = state.quickCat === cName ? 'active' : '';
      return `<button type="button" class="quick-cat-pill ${active}" data-cat="${cName}">${icon} ${cName}</button>`;
    }).join('');

    const selCat = catMap['SPESE::' + state.quickCat];
    const lbl = document.getElementById('quickSelectedLabel');
    if (lbl) lbl.textContent = `${selCat ? selCat.icon : '🛒'} ${state.quickCat}`;

    bar.querySelectorAll('.quick-cat-pill').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.quickCat = btn.getAttribute('data-cat');
        renderQuickExpenseBar();
        document.getElementById('quickAmount').focus();
      });
    });
  }

  // Render Needs vs Wants Box (Necessità Fisse vs Sfizi/Extra - Punto 2)
  function renderNeedsVsWantsBox(containerId, monthOrAll) {
    const el = document.getElementById(containerId);
    if (!el) return;

    const txs = getTransactionsFor(monthOrAll);
    const expTxs = txs.filter((t) => t.type === 'SPESE');
    const incomeTotal = txs
      .filter((t) => t.type === 'REDDITO')
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);

    const catMap = getCategoryMap();
    let needsSum = 0;
    let wantsSum = 0;

    expTxs.forEach((t) => {
      const cat = catMap['SPESE::' + t.category];
      const isNeed = cat ? Boolean(cat.flag) : DEFAULT_NEEDS_SET.has(t.category);
      if (isNeed) needsSum += Number(t.amount) || 0;
      else wantsSum += Number(t.amount) || 0;
    });

    const totalExp = needsSum + wantsSum;
    const needsPctOfExp = totalExp > 0 ? Math.round((needsSum / totalExp) * 100) : 0;
    const wantsPctOfExp = totalExp > 0 ? 100 - needsPctOfExp : 0;

    const needsPctOfInc = incomeTotal > 0 ? Math.round((needsSum / incomeTotal) * 100) : 0;
    const wantsPctOfInc = incomeTotal > 0 ? Math.round((wantsSum / incomeTotal) * 100) : 0;

    const expCats = state.data.categories.filter((c) => c.type === 'SPESE');

    el.innerHTML = `
      <div class="legend-list" style="width:100%;">
        <div class="legend-item">
          <span><span class="legend-dot" style="background:var(--savings);"></span>🏠 <b>Necessità Fisse</b> (Bollette, Spesa, Salute, Tasse)</span>
          <b>${fmtEuro(needsSum)} (${needsPctOfExp}% delle spese • ${needsPctOfInc}% reddito)</b>
        </div>
        <div class="legend-item">
          <span><span class="legend-dot" style="background:var(--debt);"></span>🍕 <b>Sfizi & Extra</b> (Cene fuori, Regali, Viaggi, Amazon)</span>
          <b>${fmtEuro(wantsSum)} (${wantsPctOfExp}% delle spese • ${wantsPctOfInc}% reddito)</b>
        </div>
        <div class="progress-track" style="height:12px; display:flex; margin-top:6px;">
          <div style="width:${needsPctOfExp}%; background:var(--savings); height:100%;" title="Necessità ${needsPctOfExp}%"></div>
          <div style="width:${wantsPctOfExp}%; background:var(--debt); height:100%;" title="Sfizi/Extra ${wantsPctOfExp}%"></div>
        </div>
        <div style="margin-top:10px; display:flex; flex-wrap:wrap; gap:5px;">
          ${expCats
            .map(
              (c) => `
            <span class="btn-toggle-need" data-catid="${c.id}" style="cursor:pointer; font-size:0.7rem; padding:2px 8px; border-radius:99px; border:1px solid var(--border); background:${
                c.flag ? 'var(--savings-bg)' : 'var(--debt-bg)'
              }; color:${c.flag ? 'var(--savings)' : 'var(--debt)'}; font-weight:700;" title="Tocca per spostare tra Necessità Fissa e Sfizio/Extra">
              ${c.icon} ${c.name}: ${c.flag ? 'Necessità' : 'Extra'}
            </span>
          `
            )
            .join('')}
        </div>
      </div>
    `;

    el.querySelectorAll('.btn-toggle-need').forEach((badge) => {
      badge.addEventListener('click', () => {
        const cid = badge.getAttribute('data-catid');
        const cat = state.data.categories.find((c) => c.id === cid);
        if (cat) {
          cat.flag = !cat.flag;
          saveData(true);
          renderAll();
        }
      });
    });
  }

  function renderCategoryBreakdownList(containerId, tp, monthOrAll) {
    const container = document.getElementById(containerId);
    const txs = getTransactionsFor(monthOrAll).filter((t) => t.type === tp);
    const cats = state.data.categories.filter((c) => c.type === tp);

    const rows = cats.map((c) => {
      const budget = getCatBudgetFor(c, monthOrAll);
      const actual = txs
        .filter((t) => t.category === c.name)
        .reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const diff = actual - budget;
      const pct = budget > 0 ? actual / budget : actual > 0 ? 1 : 0;
      return { cat: c, budget, actual, diff, pct };
    });

    const colorMap = {
      REDDITO: 'var(--income)',
      SPESE: 'var(--expense)',
      RISPARMI: 'var(--savings)',
      DEBITI: 'var(--debt)'
    };
    const barColor = colorMap[tp] || 'var(--primary)';

    const totBudget = rows.reduce((s, r) => s + r.budget, 0);
    const totActual = rows.reduce((s, r) => s + r.actual, 0);
    const totPct = totBudget > 0 ? totActual / totBudget : 0;

    let html = `
      <div class="cat-row" style="background:var(--bg-elevated); padding:10px 12px; border-radius:10px; margin-bottom:8px;">
        <div class="cat-row-top" style="margin-bottom:0;">
          <div class="cat-name-wrap"><b>TOTALE ${tp}</b></div>
          <div class="cat-amounts">
            <span class="cat-actual" style="color:${barColor}; font-size:1rem;">${fmtEuro(totActual)}</span>
            <span class="cat-budget"> / Budget: ${fmtEuro(totBudget)} (${fmtPct(totPct)})</span>
          </div>
        </div>
      </div>
    `;

    html += rows
      .map((r) => {
        const pctBar = Math.min(100, Math.max(0, Math.round(r.pct * 100)));
        let statusText = '✅ In linea col budget';
        if (r.diff > 0.01) statusText = `⬆️ +${fmtEuro(r.diff)} rispetto al budget`;
        else if (r.diff < -0.01) statusText = `⬇️ -${fmtEuro(Math.abs(r.diff))} rispetto al budget`;

    const needBadge =
      tp === 'SPESE' && state.showNeedsBox
        ? `<span style="font-size:0.66rem; padding:1px 6px; border-radius:99px; background:${
            r.cat.flag ? 'var(--savings-bg)' : 'var(--debt-bg)'
          }; color:${r.cat.flag ? 'var(--savings)' : 'var(--debt)'};">${
            r.cat.flag ? 'Necessità' : 'Extra'
          }</span>`
        : '';

    return `
        <div class="cat-row">
          <div class="cat-row-top">
            <div class="cat-name-wrap">
              <span class="cat-icon">${r.cat.icon || '📌'}</span>
              <span>${r.cat.name}</span>
              ${needBadge}
            </div>
            <div class="cat-amounts">
              <div class="cat-actual">${fmtEuro(r.actual)}</div>
              <div class="cat-budget">Obiettivo: ${fmtEuro(r.budget)} (${fmtPct(r.pct)})</div>
            </div>
          </div>
          <div class="progress-track" style="height:6px;">
            <div class="progress-fill" style="width:${pctBar}%; background:${barColor};"></div>
          </div>
          <div class="cat-row-bottom">
            <span>${statusText}</span>
            <button class="btn btn-secondary btn-quick-add" data-type="${tp}" data-cat="${r.cat.name}" style="padding:2px 9px; font-size:0.72rem;">+ Registra</button>
          </div>
        </div>
      `;
      })
      .join('');

    container.innerHTML = html;

    container.querySelectorAll('.btn-quick-add').forEach((btn) => {
      btn.addEventListener('click', () => {
        openTxModal(null, btn.getAttribute('data-type'), btn.getAttribute('data-cat'));
      });
    });
  }

  function renderMonthStrip() {
    const strip = document.getElementById('monthStrip');
    const isMonthlyView = state.activeView === 'monthly';
    const isTxView = state.activeView === 'transactions';

    strip.style.display = isMonthlyView || isTxView ? 'flex' : 'none';
    if (!isMonthlyView && !isTxView) return;

    let html = '';
    if (isTxView) {
      html += `<button class="month-chip ${state.txMonthFilter === 'ALL' ? 'active' : ''}" data-month="ALL">📅 Tutti i Mesi ${state.selectedYear}</button>`;
    }

    const currentM = isMonthlyView ? state.selectedMonth : state.txMonthFilter;

    MONTHS.forEach((m) => {
      const active = currentM === m.idx ? 'active' : '';
      html += `<button class="month-chip ${active}" data-month="${m.idx}">${m.full}</button>`;
    });

    strip.innerHTML = html;

    strip.querySelectorAll('.month-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        const val = btn.getAttribute('data-month');
        if (isMonthlyView) {
          state.selectedMonth = parseInt(val, 10);
          state.txMonthFilter = state.selectedMonth;
        } else {
          state.txMonthFilter = val === 'ALL' ? 'ALL' : parseInt(val, 10);
          if (state.txMonthFilter !== 'ALL') state.selectedMonth = state.txMonthFilter;
        }
        renderAll();
      });
    });
  }

  // ==========================================================================
  // VIEW 1: DASHBOARD MENSILE
  // ==========================================================================
  function renderMonthlyDashboard() {
    renderQuickExpenseBar();

    const mIdx = state.selectedMonth;
    const mObj = MONTHS[mIdx];
    const totals = computeTotalsFor(mIdx);

    document.getElementById('headerSubtitle').textContent = `📆 DASHBOARD MENSILE • ${mObj.full.toUpperCase()} ${state.selectedYear}`;

    document.getElementById('monthlyKpiGrid').innerHTML = buildKpiGridHtml(totals);

    const actualResidual =
      totals.REDDITO.actual - totals.SPESE.actual - totals.DEBITI.actual - totals.RISPARMI.actual;
    const budgetResidual =
      totals.REDDITO.budget - totals.SPESE.budget - totals.DEBITI.budget - totals.RISPARMI.budget;
    const expPctOfIncome =
      totals.REDDITO.actual > 0 ? totals.SPESE.actual / totals.REDDITO.actual : 0;
    const debtPctOfIncome =
      totals.REDDITO.actual > 0 ? totals.DEBITI.actual / totals.REDDITO.actual : 0;

    document.getElementById('monthlyResidualBanner').innerHTML = `
      <div class="residual-main">
        <span class="residual-title">💰 REDDITO RESIDUO EFFETTIVO (${mObj.full.toUpperCase()} ${state.selectedYear})</span>
        <span class="residual-amount" style="color:${actualResidual >= 0 ? 'var(--income)' : 'var(--expense)'};">
          ${fmtEuro(actualResidual)}
        </span>
      </div>
      <div class="residual-stats">
        <div class="residual-stat-item">
          <span>Reddito Residuo (Budget)</span>
          <b>${fmtEuro(budgetResidual)}</b>
        </div>
        <div class="residual-stat-item">
          <span>% Spese sul Reddito</span>
          <b>${fmtPct(expPctOfIncome)}</b>
        </div>
        <div class="residual-stat-item">
          <span>% Debiti sul Reddito</span>
          <b>${fmtPct(debtPctOfIncome)}</b>
        </div>
      </div>
    `;

    const inc = Math.max(1, totals.REDDITO.actual);
    const spPct = Math.min(100, Math.round((totals.SPESE.actual / inc) * 100));
    const dbPct = Math.min(100, Math.round((totals.DEBITI.actual / inc) * 100));
    const resPct = Math.max(0, 100 - spPct - dbPct);

    document.getElementById('monthlyDonutWrap').innerHTML = `
      <div class="legend-list" style="width:100%;">
        <div class="legend-item">
          <span><span class="legend-dot" style="background:var(--income);"></span>Reddito Effettivo</span>
          <b>${fmtEuro(totals.REDDITO.actual)} (100%)</b>
        </div>
        <div class="legend-item">
          <span><span class="legend-dot" style="background:var(--expense);"></span>Spese del Mese</span>
          <b>${fmtEuro(totals.SPESE.actual)} (${spPct}%)</b>
        </div>
        <div class="legend-item">
          <span><span class="legend-dot" style="background:var(--debt);"></span>Debiti del Mese</span>
          <b>${fmtEuro(totals.DEBITI.actual)} (${dbPct}%)</b>
        </div>
        <div class="legend-item">
          <span><span class="legend-dot" style="background:var(--primary);"></span>Residuo Libero</span>
          <b>${fmtEuro(actualResidual)} (${resPct}%)</b>
        </div>
        <div class="progress-track" style="height:12px; display:flex; margin-top:6px;">
          <div style="width:${spPct}%; background:var(--expense); height:100%;"></div>
          <div style="width:${dbPct}%; background:var(--debt); height:100%;"></div>
          <div style="width:${resPct}%; background:var(--income); height:100%;"></div>
        </div>
      </div>
    `;

    // Punto 2: Necessità vs Extra
    renderNeedsVsWantsBox('monthlyNeedsVsWantsWrap', mIdx);

    // Top Expenses
    const mTxs = getTransactionsFor(mIdx).filter((t) => t.type === 'SPESE');
    const expByCat = {};
    mTxs.forEach((t) => {
      expByCat[t.category] = (expByCat[t.category] || 0) + (Number(t.amount) || 0);
    });
    const topExp = Object.entries(expByCat)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);

    if (topExp.length === 0) {
      document.getElementById('monthlyTopExpensesWrap').innerHTML = `<div style="color:var(--text-muted); font-size:0.84rem;">Nessuna spesa registrata in ${mObj.full}.</div>`;
    } else {
      const maxE = topExp[0][1] || 1;
      document.getElementById('monthlyTopExpensesWrap').innerHTML = topExp
        .map(([cName, val]) => {
          const w = Math.round((val / maxE) * 100);
          return `
          <div style="margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; font-size:0.8rem; font-weight:700; margin-bottom:2px;">
              <span>${cName}</span>
              <span style="color:var(--expense);">${fmtEuro(val)}</span>
            </div>
            <div class="progress-track" style="height:6px; margin-top:2px;">
              <div class="progress-fill" style="width:${w}%; background:var(--expense);"></div>
            </div>
          </div>
        `;
        })
        .join('');
    }

    renderCategoryBreakdownList('monthlyCategoryBreakdown', state.monthlyType, mIdx);
  }

  // ==========================================================================
  // VIEW 2: DASHBOARD ANNUALE
  // ==========================================================================
  function renderAnnualDashboard() {
    document.getElementById('headerSubtitle').textContent = `📊 DASHBOARD ANNUALE • TUTTO IL ${state.selectedYear}`;

    const totals = computeTotalsFor('ALL');
    document.getElementById('annualKpiGrid').innerHTML = buildKpiGridHtml(totals);

    const actualResidual =
      totals.REDDITO.actual - totals.SPESE.actual - totals.DEBITI.actual - totals.RISPARMI.actual;
    const budgetResidual =
      totals.REDDITO.budget - totals.SPESE.budget - totals.DEBITI.budget - totals.RISPARMI.budget;
    const expPctOfIncome =
      totals.REDDITO.actual > 0 ? (totals.SPESE.actual + totals.DEBITI.actual) / totals.REDDITO.actual : 0;

    document.getElementById('annualResidualBanner').innerHTML = `
      <div class="residual-main">
        <span class="residual-title">🏆 REDDITO RESIDUO ANNUO EFFETTIVO (ANNO ${state.selectedYear})</span>
        <span class="residual-amount" style="color:${actualResidual >= 0 ? 'var(--income)' : 'var(--expense)'};">
          ${fmtEuro(actualResidual)}
        </span>
      </div>
      <div class="residual-stats">
        <div class="residual-stat-item">
          <span>Residuo Annuo da Budget</span>
          <b>${fmtEuro(budgetResidual)}</b>
        </div>
        <div class="residual-stat-item">
          <span>Totale Entrate ${state.selectedYear}</span>
          <b>${fmtEuro(totals.REDDITO.actual)}</b>
        </div>
        <div class="residual-stat-item">
          <span>Totale Uscite (Spese+Debiti)</span>
          <b>${fmtEuro(totals.SPESE.actual + totals.DEBITI.actual)} (${fmtPct(expPctOfIncome)})</b>
        </div>
      </div>
    `;

    const yearTxs = getTransactionsFor('ALL');
    const monthlyStats = MONTHS.map((m) => {
      const mTxs = yearTxs.filter((t) => parseInt(t.date.slice(5, 7), 10) - 1 === m.idx);
      const inc = mTxs.filter((t) => t.type === 'REDDITO').reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const exp = mTxs.filter((t) => t.type === 'SPESE').reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const deb = mTxs.filter((t) => t.type === 'DEBITI').reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const sav = mTxs.filter((t) => t.type === 'RISPARMI').reduce((s, t) => s + (Number(t.amount) || 0), 0);
      const out = exp + deb;
      const res = inc - out - sav;
      return { month: m, inc, exp, deb, sav, out, res };
    });

    const maxVal = Math.max(100, ...monthlyStats.map((s) => Math.max(s.inc, s.out)));
    const chartEl = document.getElementById('annualChart');

    chartEl.innerHTML = monthlyStats
      .map((s) => {
        const incH = Math.round((s.inc / maxVal) * 125);
        const outH = Math.round((s.out / maxVal) * 125);
        return `
        <div class="chart-col" data-m="${s.month.idx}" style="cursor:pointer;" title="Clicca per aprire ${s.month.full}: Reddito ${fmtEuro(s.inc)} | Uscite ${fmtEuro(s.out)}">
          <div class="chart-bars">
            <div class="chart-bar" style="height:${incH}px; background:var(--income);"></div>
            <div class="chart-bar" style="height:${outH}px; background:var(--expense);"></div>
          </div>
          <span class="chart-label">${s.month.short}</span>
        </div>
      `;
      })
      .join('');

    chartEl.querySelectorAll('.chart-col').forEach((col) => {
      col.addEventListener('click', () => {
        const idx = parseInt(col.getAttribute('data-m'), 10);
        state.selectedMonth = idx;
        switchView('monthly');
      });
    });

    renderNeedsVsWantsBox('annualNeedsVsWantsWrap', 'ALL');

    const tbl = document.getElementById('annualMonthsTable');
    let htmlTbl = `<thead><tr><th>Voce</th>${MONTHS.map((m) => `<th>${m.short}</th>`).join('')}<th>Totale Annuo</th></tr></thead><tbody>`;
    htmlTbl += `<tr><td><b style="color:var(--income);">💶 Reddito</b></td>${monthlyStats.map((s) => `<td>${fmtEuro(s.inc)}</td>`).join('')}<td><b>${fmtEuro(totals.REDDITO.actual)}</b></td></tr>`;
    htmlTbl += `<tr><td><b style="color:var(--expense);">🛒 Spese</b></td>${monthlyStats.map((s) => `<td>${fmtEuro(s.exp)}</td>`).join('')}<td><b>${fmtEuro(totals.SPESE.actual)}</b></td></tr>`;
    htmlTbl += `<tr><td><b style="color:var(--debt);">💳 Debiti</b></td>${monthlyStats.map((s) => `<td>${fmtEuro(s.deb)}</td>`).join('')}<td><b>${fmtEuro(totals.DEBITI.actual)}</b></td></tr>`;
    htmlTbl += `<tr style="background:var(--bg-elevated); font-weight:800;"><td>💰 Residuo Mese</td>${monthlyStats
      .map((s) => `<td style="color:${s.res >= 0 ? 'var(--income)' : 'var(--expense)'};">${fmtEuro(s.res)}</td>`)
      .join('')}<td style="color:${actualResidual >= 0 ? 'var(--income)' : 'var(--expense)'};">${fmtEuro(actualResidual)}</td></tr>`;
    htmlTbl += `</tbody>`;
    tbl.innerHTML = htmlTbl;

    renderCategoryBreakdownList('annualCategoryBreakdown', state.annualType, 'ALL');
  }

  // ==========================================================================
  // VIEW 3: TRANSAZIONI / MOVIMENTI
  // ==========================================================================
  function renderTransactions() {
    const pLabel =
      state.txMonthFilter === 'ALL'
        ? `Tutti i Mesi ${state.selectedYear}`
        : `${MONTHS[state.txMonthFilter].full} ${state.selectedYear}`;
    document.getElementById('headerSubtitle').textContent = `🧾 MOVIMENTI • ${pLabel.toUpperCase()}`;

    const search = (document.getElementById('txSearch').value || '').toLowerCase().trim();
    const typeFilter = document.getElementById('txTypeFilter').value;
    const catFilterSelect = document.getElementById('txCatFilter');
    const currentCatFilter = catFilterSelect.value;

    const relevantCats = state.data.categories.filter(
      (c) => typeFilter === 'ALL' || c.type === typeFilter
    );
    let catOpts = `<option value="ALL">Tutte le Categorie</option>`;
    relevantCats.forEach((c) => {
      catOpts += `<option value="${c.name}" ${currentCatFilter === c.name ? 'selected' : ''}>${c.icon} ${c.name}</option>`;
    });
    catFilterSelect.innerHTML = catOpts;

    let txs = getTransactionsFor(state.txMonthFilter);

    if (typeFilter !== 'ALL') {
      txs = txs.filter((t) => t.type === typeFilter);
    }
    if (catFilterSelect.value !== 'ALL') {
      txs = txs.filter((t) => t.category === catFilterSelect.value);
    }
    if (search) {
      txs = txs.filter(
        (t) =>
          (t.category && t.category.toLowerCase().includes(search)) ||
          (t.description && t.description.toLowerCase().includes(search)) ||
          String(t.amount).includes(search) ||
          (t.date && t.date.includes(search))
      );
    }

    txs.sort((a, b) => (b.date || '').localeCompare(a.date || '') || String(b.id).localeCompare(String(a.id)));

    document.getElementById('txCountLabel').textContent = txs.length;

    const sumIncome = txs.filter((t) => t.type === 'REDDITO').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const sumExp = txs.filter((t) => t.type === 'SPESE').reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const sumDebt = txs.filter((t) => t.type === 'DEBITI').reduce((s, t) => s + (Number(t.amount) || 0), 0);

    document.getElementById('txSummaryLine').innerHTML = `
      <span>Reddito filtrato: <b style="color:var(--income);">${fmtEuro(sumIncome)}</b></span>
      <span>Spese filtrate: <b style="color:var(--expense);">${fmtEuro(sumExp)}</b></span>
      <span>Debiti filtrati: <b style="color:var(--debt);">${fmtEuro(sumDebt)}</b></span>
    `;

    const catMap = getCategoryMap();
    const listEl = document.getElementById('txList');

    if (txs.length === 0) {
      listEl.innerHTML = `<div style="padding:28px; text-align:center; color:var(--text-muted);">Nessun movimento trovato con questi filtri.</div>`;
      return;
    }

    const typeStyle = {
      REDDITO: { color: 'var(--income)', bg: 'var(--income-bg)', sign: '+' },
      SPESE: { color: 'var(--expense)', bg: 'var(--expense-bg)', sign: '-' },
      DEBITI: { color: 'var(--debt)', bg: 'var(--debt-bg)', sign: '-' },
      RISPARMI: { color: 'var(--savings)', bg: 'var(--savings-bg)', sign: '' }
    };

    listEl.innerHTML = txs
      .map((tx) => {
        const catObj = catMap[tx.type + '::' + tx.category];
        const icon = catObj ? catObj.icon : tx.type === 'REDDITO' ? '💰' : '🛒';
        const st = typeStyle[tx.type] || typeStyle.SPESE;
        const dateParts = (tx.date || '').split('-');
        const dateIt = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : tx.date;

        return `
        <div class="tx-item" data-id="${tx.id}">
          <div class="tx-left">
            <span class="cat-icon" style="width:38px; height:38px; font-size:1.15rem;">${icon}</span>
            <div class="tx-info">
              <div class="tx-cat">${tx.category}</div>
              <div class="tx-meta">${dateIt}${tx.description ? ' • ' + tx.description : ''}</div>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-amount" style="color:${st.color};">${st.sign}${fmtEuro(tx.amount)}</div>
            <span class="tx-type-pill" style="background:${st.bg}; color:${st.color};">${tx.type}</span>
          </div>
        </div>
      `;
      })
      .join('');

    listEl.querySelectorAll('.tx-item').forEach((item) => {
      item.addEventListener('click', () => {
        const id = item.getAttribute('data-id');
        const tx = state.data.transactions.find((t) => t.id === id);
        if (tx) openTxModal(tx);
      });
    });
  }

  // ==========================================================================
  // VIEW 4: FATTURE & CALCOLO TASSE / ACCONTI ANNO PROSSIMO (Regole Ufficiali Forfettario)
  // ==========================================================================
  function renderTaxesView() {
    document.getElementById('headerSubtitle').textContent = `🧮 FATTURE & SIMULATORE TASSE • ANNO ${state.selectedYear}`;
    document.getElementById('invYearLabel').textContent = state.selectedYear;

    const ts = state.data.taxSettings;
    // Get paid F24 breakdown for the current selectedYear (auto-carryover from previous year)
    if (!state.data.taxPaidByYear) {
      state.data.taxPaidByYear = {
        2026: { june: { inps: 907.23, imposta: 152.50, saldoPrev: 379.00, credito: 148.00 }, nov: { inps: 907.24, imposta: 152.50 } }
      };
    }

    function computeYearTaxSummary(yr) {
      const yrInvs = state.data.invoices.filter(
        (inv) => inv.date && parseInt(inv.date.slice(0, 4), 10) === yr
      );
      const fatt = yrInvs.reduce((s, i) => s + (Number(i.amount) || 0), 0);
      const impLordo = fatt * ((Number(ts.coeff) || 86) / 100);
      const inps = impLordo * ((Number(ts.inpsRate) || 26.07) / 100);
      const impNetto = Math.max(0, impLordo - inps);
      const irpef = impNetto * ((Number(ts.irpefRate) || 5) / 100);
      const totComp = inps + irpef;
      // Regola commercialista: acconto INPS = 80% (40% giu + 40% nov), acconto imposta = 100% (50% giu + 50% nov)
      const acc1 = inps * 0.40 + irpef * 0.50;
      const acc2 = inps * 0.40 + irpef * 0.50;
      return { fatt, impLordo, inps, irpef, totComp, acc1, acc2, count: yrInvs.length };
    }

    // Auto-carryover: switching to 2027 imports the acconti computed on 2026
    if (!state.data.taxPaidByYear[state.selectedYear]) {
      const prevSummary = computeYearTaxSummary(state.selectedYear - 1);
      if (prevSummary.count > 0) {
        state.data.taxPaidByYear[state.selectedYear] = {
          june: { inps: Math.round(prevSummary.inps * 0.40 * 100) / 100, imposta: Math.round(prevSummary.irpef * 0.50 * 100) / 100, saldoPrev: Math.round(Math.max(0, prevSummary.inps - prevSummary.inps * 0.80) * 100) / 100, credito: 0 },
          nov: { inps: Math.round(prevSummary.inps * 0.40 * 100) / 100, imposta: Math.round(prevSummary.irpef * 0.50 * 100) / 100 }
        };
      } else {
        state.data.taxPaidByYear[state.selectedYear] = { june: { inps: 0, imposta: 0, saldoPrev: 0, credito: 0 }, nov: { inps: 0, imposta: 0 } };
      }
    }

    const curPaid = state.data.taxPaidByYear[state.selectedYear];
    ts.june = curPaid.june;
    ts.nov = curPaid.nov;

    document.getElementById('taxCoeff').value = ts.coeff;
    document.getElementById('taxIrpefRate').value = ts.irpefRate;
    document.getElementById('taxInpsRate').value = ts.inpsRate;
    document.getElementById('taxJuneInps').value = ts.june.inps;
    document.getElementById('taxJuneImp').value = ts.june.imposta;
    document.getElementById('taxJuneSaldo').value = ts.june.saldoPrev;
    document.getElementById('taxJuneCredito').value = ts.june.credito;
    document.getElementById('taxNovInps').value = ts.nov.inps;
    document.getElementById('taxNovImp').value = ts.nov.imposta;

    // Filter invoices for selectedYear
    const yearInvoices = state.data.invoices.filter(
      (inv) => inv.date && parseInt(inv.date.slice(0, 4), 10) === state.selectedYear
    );
    yearInvoices.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

    document.getElementById('invCountLabel').textContent = yearInvoices.length;

    const fatturatoImponibile = yearInvoices.reduce((s, i) => s + (Number(i.amount) || 0), 0);
    const bolliTotali = yearInvoices.reduce((s, i) => s + (Number(i.stamp) || 0), 0);

    // Calcolo Ufficiale dal PDF F24 (Regime Forfettario ATECO 68.32.00):
    const redditoImponibile = fatturatoImponibile * ((Number(ts.coeff) || 86) / 100);
    const inpsDovuta = redditoImponibile * ((Number(ts.inpsRate) || 26.07) / 100);

    // Deduzione INPS per l'imposta: criterio di cassa (contributi VERSATI nell'anno 2026)
    // = acconti INPS 2026 (giu+nov) + saldo INPS 2025 pagato a giugno 2026
    const inpsPagataNellAnno = (Number(ts.june.inps) || 0) + (Number(ts.june.saldoPrev) || 0) + (Number(ts.nov.inps) || 0);
    const imponibileNettoIrpef = Math.max(0, redditoImponibile - inpsPagataNellAnno);
    const impostaDovuta = imponibileNettoIrpef * ((Number(ts.irpefRate) || 5) / 100);

    const totaleTasseCompetenza = impostaDovuta + inpsDovuta;

    // Acconti già versati per l'anno in corso (dal PDF F24):
    const accontiInpsVersati = (Number(ts.june.inps) || 0) + (Number(ts.nov.inps) || 0);
    const accontiImpostaVersati = (Number(ts.june.imposta) || 0) + (Number(ts.nov.imposta) || 0);
    const totaleAccontiVersati = accontiInpsVersati + accontiImpostaVersati;

    // SALDO ANNO CORRENTE (spaccato INPS + Imposta come fa il commercialista):
    const saldoInps = Math.max(0, inpsDovuta - accontiInpsVersati);
    const saldoImposta = Math.max(0, impostaDovuta - accontiImpostaVersati);
    const saldoAnnoCorrente = saldoInps + saldoImposta;
    const eventualeCredito = Math.max(0, totaleAccontiVersati - totaleTasseCompetenza);

    // ACCONTI ANNO PROSSIMO (regole commercialista dai PDF):
    // - INPS: 80% del dovuto, diviso 40% a Giugno + 40% a Novembre
    // - Imposta: 100% del dovuto, diviso 50% a Giugno + 50% a Novembre
    const accontoInpsGiugno = inpsDovuta * 0.40;
    const accontoInpsNovembre = inpsDovuta * 0.40;
    const accontoImpostaGiugno = impostaDovuta * 0.50;
    const accontoImpostaNovembre = impostaDovuta * 0.50;

    const primoAccontoGiugno = accontoInpsGiugno + accontoImpostaGiugno;
    const secondoAccontoNovembre = accontoInpsNovembre + accontoImpostaNovembre;

    const totaleScadenzaGiugno = Math.max(0, saldoAnnoCorrente + primoAccontoGiugno - eventualeCredito);
    const totaleComplessivoF24AnnoProssimo = totaleScadenzaGiugno + secondoAccontoNovembre;
    const nettoRealeInTasca = fatturatoImponibile - totaleTasseCompetenza;

    const nextYear = state.selectedYear + 1;

    document.getElementById('taxKpiGrid').innerHTML = `
      <div class="kpi-card">
        <div class="kpi-label">📄 FATTURATO INCASSATO ${state.selectedYear}</div>
        <div class="kpi-value" style="color:var(--income);">${fmtEuro(fatturatoImponibile)}</div>
        <div class="kpi-sub">Imponibile (${ts.coeff}%): <b>${fmtEuro(redditoImponibile)}</b></div>
        <div class="kpi-sub">Fatture: <b>${yearInvoices.length}</b> (+ ${fmtEuro(bolliTotali)} bolli)</div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">🏛️ TOTALE COMPETENZA ${state.selectedYear}</div>
        <div class="kpi-value" style="color:var(--expense);">${fmtEuro(totaleTasseCompetenza)}</div>
        <div class="kpi-sub">Imposta Sost. (${ts.irpefRate}%): <b>${fmtEuro(impostaDovuta)}</b></div>
        <div class="kpi-sub">INPS (${ts.inpsRate}%): <b>${fmtEuro(inpsDovuta)}</b></div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">⚖️ SALDO ${state.selectedYear} (SCALATI ACCONTI)</div>
        <div class="kpi-value" style="color:var(--debt);">${fmtEuro(saldoAnnoCorrente)}</div>
        <div class="kpi-sub">Saldo INPS: <b>${fmtEuro(saldoInps)}</b></div>
        <div class="kpi-sub">Saldo Imposta: <b>${fmtEuro(saldoImposta)}</b></div>
      </div>

      <div class="kpi-card">
        <div class="kpi-label">💶 NETTO REALE PULITO</div>
        <div class="kpi-value" style="color:var(--primary);">${fmtEuro(nettoRealeInTasca)}</div>
        <div class="kpi-sub">Ti resta il <b>${
          fatturatoImponibile > 0 ? Math.round((nettoRealeInTasca / fatturatoImponibile) * 100) : 74
        }%</b> pulito in tasca</div>
        <div class="kpi-sub">Incidenza totale Tasse+INPS: <b>${
          fatturatoImponibile > 0 ? Math.round((totaleTasseCompetenza / fatturatoImponibile) * 100) : 26
        }%</b></div>
      </div>
    `;

    document.getElementById('taxDeadlinesGrid').innerHTML = `
      <div class="scadenza-card" style="border-left-color:var(--expense);">
        <div style="font-size:0.75rem; font-weight:800; color:var(--text-muted);">📅 1. SALDO ${state.selectedYear} (GIUGNO ${nextYear})</div>
        <div style="font-size:1.45rem; font-weight:800; color:var(--expense); margin:4px 0;">${fmtEuro(saldoAnnoCorrente)}</div>
        <div style="font-size:0.78rem; color:var(--text-muted); line-height:1.45;">
          • Saldo INPS ${state.selectedYear} (cod. 5500): <b>${fmtEuro(saldoInps)}</b> — Dovuta ${fmtEuro(inpsDovuta)} − acconti ${fmtEuro(accontiInpsVersati)}<br/>
          • Saldo Imposta (cod. 1792): <b>${fmtEuro(saldoImposta)}</b> — Dovuta ${fmtEuro(impostaDovuta)} − acconti ${fmtEuro(accontiImpostaVersati)}
        </div>
      </div>

      <div class="scadenza-card" style="border-left-color:var(--debt);">
        <div style="font-size:0.75rem; font-weight:800; color:var(--text-muted);">📅 2. 1° ACCONTO ${nextYear} (GIUGNO ${nextYear})</div>
        <div style="font-size:1.45rem; font-weight:800; color:var(--debt); margin:4px 0;">${fmtEuro(primoAccontoGiugno)}</div>
        <div style="font-size:0.78rem; color:var(--text-muted); line-height:1.45;">
          • 1° Acconto INPS (40%): <b>${fmtEuro(accontoInpsGiugno)}</b><br/>
          • 1° Acconto Imposta 5% (50%): <b>${fmtEuro(accontoImpostaGiugno)}</b><br/>
          <i>(Somma col Saldo = ${fmtEuro(totaleScadenzaGiugno)}, rateizzabile in 6 rate da ${fmtEuro(totaleScadenzaGiugno / 6)}/mese)</i>
        </div>
      </div>

      <div class="scadenza-card" style="border-left-color:var(--primary);">
        <div style="font-size:0.75rem; font-weight:800; color:var(--text-muted);">📅 3. 2° ACCONTO ${nextYear} (NOVEMBRE ${nextYear})</div>
        <div style="font-size:1.45rem; font-weight:800; color:var(--primary); margin:4px 0;">${fmtEuro(secondoAccontoNovembre)}</div>
        <div style="font-size:0.78rem; color:var(--text-muted); line-height:1.45;">
          • 2° Acconto INPS (40%): <b>${fmtEuro(accontoInpsNovembre)}</b><br/>
          • 2° Acconto Imposta 5% (50%): <b>${fmtEuro(accontoImpostaNovembre)}</b>
        </div>
      </div>
    `;

    // Render Invoices List
    const invListEl = document.getElementById('invoicesList');
    if (yearInvoices.length === 0) {
      invListEl.innerHTML = `<div style="padding:24px; text-align:center; color:var(--text-muted);">
        Nessuna fattura inserita per il ${state.selectedYear}.<br/>
        Clicca <b>"+ Nuova Fattura"</b> per aggiungerne una a mano, oppure <b>"⚡ Importa da Redditi Condomini"</b> per provare subito il simulatore coi compensi già registrati!
      </div>`;
      return;
    }

    invListEl.innerHTML = yearInvoices
      .map((inv) => {
        const dp = (inv.date || '').split('-');
        const dateIt = dp.length === 3 ? `${dp[2]}/${dp[1]}/${dp[0]}` : inv.date;
        return `
        <div class="tx-item" data-invid="${inv.id}">
          <div class="tx-left">
            <span class="cat-icon" style="width:38px; height:38px; font-size:1.1rem;">📄</span>
            <div class="tx-info">
              <div class="tx-cat">Fatt. n. ${inv.number} • ${inv.client}</div>
              <div class="tx-meta">${dateIt}${inv.notes ? ' • ' + inv.notes : ''}${
          inv.stamp ? ' • Bollo: ' + fmtEuro(inv.stamp) : ''
        }</div>
            </div>
          </div>
          <div class="tx-right">
            <div class="tx-amount" style="color:var(--income);">${fmtEuro(inv.amount)}</div>
            <span class="tx-type-pill" style="background:var(--income-bg); color:var(--income);">INCASSATA</span>
          </div>
        </div>
      `;
      })
      .join('');

    invListEl.querySelectorAll('.tx-item').forEach((el) => {
      el.addEventListener('click', () => {
        const id = el.getAttribute('data-invid');
        const inv = state.data.invoices.find((i) => i.id === id);
        if (inv) openInvModal(inv);
      });
    });
  }

  // ==========================================================================
  // VIEW 5: BUDGET ANNUALE
  // ==========================================================================
  function renderBudget() {
    document.getElementById('headerSubtitle').textContent = `🎯 BUDGET PREVENTIVO • ANNO ${state.selectedYear}`;
    const tp = state.budgetType;
    const cats = state.data.categories.filter((c) => c.type === tp);
    const table = document.getElementById('budgetTable');

    const allCats = state.data.categories;
    const sumByTypeYear = (t) =>
      allCats
        .filter((c) => c.type === t)
        .reduce((acc, c) => acc + (c.budget || []).reduce((s, v) => s + (Number(v) || 0), 0), 0);

    const totInc = sumByTypeYear('REDDITO');
    const totExp = sumByTypeYear('SPESE');
    const totSav = sumByTypeYear('RISPARMI');
    const totDeb = sumByTypeYear('DEBITI');
    const unallocated = totInc - totExp - totSav - totDeb;

    document.getElementById('budgetAllocationSummary').innerHTML = `
      <div class="residual-banner" style="margin-bottom:8px; padding:10px 14px;">
        <div>
          <span style="font-size:0.76rem; color:var(--text-muted); font-weight:700;">ANCORA DA ALLOCARE (ANNO ${state.selectedYear})</span>
          <div style="font-size:1.25rem; font-weight:800; color:${unallocated >= 0 ? 'var(--income)' : 'var(--expense)'};">${fmtEuro(unallocated)}</div>
        </div>
        <div class="residual-stats">
          <div class="residual-stat-item"><span>Reddito Budget</span><b>${fmtEuro(totInc)}</b></div>
          <div class="residual-stat-item"><span>Spese Budget</span><b>${fmtEuro(totExp)}</b></div>
          <div class="residual-stat-item"><span>Risparmi Budget</span><b>${fmtEuro(totSav)}</b></div>
          <div class="residual-stat-item"><span>Debiti Budget</span><b>${fmtEuro(totDeb)}</b></div>
        </div>
      </div>
    `;

    let thead = `<thead><tr><th>Categoria (${tp})</th><th title="Copia Gennaio su tutti i mesi">⇄</th>`;
    MONTHS.forEach((m) => {
      thead += `<th>${m.short}</th>`;
    });
    thead += `<th>Totale</th></tr></thead>`;

    let tbody = `<tbody>`;
    const colTotals = new Array(12).fill(0);

    cats.forEach((c) => {
      if (!Array.isArray(c.budget) || c.budget.length < 12) {
        c.budget = new Array(12).fill(0);
      }
      const rowTot = c.budget.reduce((s, v) => s + (Number(v) || 0), 0);
      tbody += `<tr>
        <td><b>${c.icon || ''} ${c.name}</b></td>
        <td><button class="icon-btn btn-copy-months" data-catid="${c.id}" style="width:26px; height:26px; font-size:0.75rem;" title="Copia il valore di Gennaio su tutti i 12 mesi">⇄</button></td>`;
      for (let m = 0; m < 12; m++) {
        const val = Number(c.budget[m]) || 0;
        colTotals[m] += val;
        tbody += `<td><input type="number" step="1" class="budget-input" data-catid="${c.id}" data-m="${m}" value="${val}" /></td>`;
      }
      tbody += `<td style="font-weight:800;">${fmtEuro(rowTot)}</td></tr>`;
    });

    const grandTotal = colTotals.reduce((s, v) => s + v, 0);
    tbody += `<tr style="background:var(--bg-elevated); font-weight:800;">
      <td>TOTALE ${tp}</td>
      <td></td>
      ${colTotals.map((v) => `<td>${fmtEuro(v)}</td>`).join('')}
      <td style="color:var(--primary);">${fmtEuro(grandTotal)}</td>
    </tr></tbody>`;

    table.innerHTML = thead + tbody;

    table.querySelectorAll('.budget-input').forEach((inp) => {
      inp.addEventListener('change', () => {
        const catId = inp.getAttribute('data-catid');
        const m = parseInt(inp.getAttribute('data-m'), 10);
        const cat = state.data.categories.find((c) => c.id === catId);
        if (cat) {
          cat.budget[m] = parseFloat(inp.value) || 0;
          saveData(true);
          renderBudget();
        }
      });
    });

    table.querySelectorAll('.btn-copy-months').forEach((btn) => {
      btn.addEventListener('click', () => {
        const catId = btn.getAttribute('data-catid');
        const cat = state.data.categories.find((c) => c.id === catId);
        if (cat) {
          const janVal = Number(cat.budget[0]) || 0;
          cat.budget = new Array(12).fill(janVal);
          saveData(true);
          renderBudget();
        }
      });
    });
  }

  // ==========================================================================
  // VIEW 6: CATEGORIE
  // ==========================================================================
  function renderCategories() {
    document.getElementById('headerSubtitle').textContent = `🏷️ GESTIONE CATEGORIE (${state.data.categories.length} VOCI)`;
    const tp = state.catType;
    const cats = state.data.categories.filter((c) => c.type === tp);
    const listEl = document.getElementById('categoriesList');

    listEl.innerHTML = cats
      .map((c) => {
        const annualBudget = (c.budget || []).reduce((s, v) => s + (Number(v) || 0), 0);
        const txCount = state.data.transactions.filter(
          (t) => t.type === c.type && t.category === c.name
        ).length;
        const flagLabel =
          c.type === 'SPESE' ? ` • ${c.flag ? '🏠 Necessità Fissa' : '🍕 Sfizio/Extra'}` : '';

        return `
        <div class="tx-item" data-catid="${c.id}" style="margin-bottom:8px;">
          <div class="tx-left">
            <span class="cat-icon" style="width:38px; height:38px; font-size:1.2rem;">${c.icon || '📌'}</span>
            <div class="tx-info">
              <div class="tx-cat">${c.name}</div>
              <div class="tx-meta">${txCount} movimenti • Budget annuo: ${fmtEuro(annualBudget)}${flagLabel}</div>
            </div>
          </div>
          <div class="tx-right">
            <button class="btn btn-secondary" style="padding:6px 10px; font-size:0.78rem;">✏️ Modifica</button>
          </div>
        </div>
      `;
      })
      .join('');

    listEl.querySelectorAll('.tx-item').forEach((el) => {
      el.addEventListener('click', () => {
        const catId = el.getAttribute('data-catid');
        const cat = state.data.categories.find((c) => c.id === catId);
        if (cat) openCatModal(cat);
      });
    });
  }

  // Modal Functions
  function populateModalCategories(type, selectedCatName) {
    const sel = document.getElementById('txCategory');
    const cats = state.data.categories.filter((c) => c.type === type);
    sel.innerHTML = cats
      .map(
        (c) =>
          `<option value="${c.name}" ${c.name === selectedCatName ? 'selected' : ''}>${c.icon} ${c.name}</option>`
      )
      .join('');
  }

  function setModalType(type, selectedCatName) {
    state.txModalType = type;
    document.querySelectorAll('#txFormTypeSelector .type-choice').forEach((el) => {
      el.classList.toggle('selected', el.getAttribute('data-type') === type);
    });
    populateModalCategories(type, selectedCatName);
  }

  function openTxModal(tx = null, defaultType = 'SPESE', defaultCat = '') {
    const modal = document.getElementById('txModal');
    const delBtn = document.getElementById('btnDeleteTx');

    if (tx) {
      document.getElementById('txModalTitle').textContent = 'Modifica Movimento';
      document.getElementById('txId').value = tx.id;
      document.getElementById('txDate').value = tx.date;
      document.getElementById('txAmount').value = tx.amount;
      document.getElementById('txDescription').value = tx.description || '';
      setModalType(tx.type, tx.category);
      delBtn.style.display = 'inline-flex';
    } else {
      document.getElementById('txModalTitle').textContent = 'Nuovo Movimento';
      document.getElementById('txId').value = '';
      const today = new Date().toISOString().slice(0, 10);
      document.getElementById('txDate').value = today;
      document.getElementById('txAmount').value = '';
      document.getElementById('txDescription').value = '';
      setModalType(defaultType, defaultCat);
      delBtn.style.display = 'none';
    }

    modal.classList.add('open');
  }

  function openInvModal(inv = null) {
    const modal = document.getElementById('invModal');
    const delBtn = document.getElementById('btnDeleteInv');

    // Populate datalist with condomini names
    const dl = document.getElementById('condominiClientsList');
    const condomini = state.data.categories
      .filter(
        (c) =>
          c.type === 'REDDITO' &&
          !c.name.toLowerCase().includes('estella') &&
          !c.name.toLowerCase().includes('consu')
      )
      .map((c) => c.name);
    dl.innerHTML = condomini.map((n) => `<option value="Condominio ${n}"></option>`).join('');

    if (inv) {
      document.getElementById('invModalTitle').textContent = 'Modifica Fattura';
      document.getElementById('invId').value = inv.id;
      document.getElementById('invNum').value = inv.number;
      document.getElementById('invDate').value = inv.date;
      document.getElementById('invClient').value = inv.client;
      document.getElementById('invAmount').value = inv.amount;
      document.getElementById('invStamp').value = inv.stamp || 0;
      document.getElementById('invNotes').value = inv.notes || '';
      delBtn.style.display = 'inline-flex';
    } else {
      document.getElementById('invModalTitle').textContent = 'Nuova Fattura Emessa';
      document.getElementById('invId').value = '';
      const countThisYear = state.data.invoices.filter(
        (i) => i.date && i.date.startsWith(String(state.selectedYear))
      ).length;
      document.getElementById('invNum').value = `${countThisYear + 1}/${state.selectedYear}`;
      document.getElementById('invDate').value = new Date().toISOString().slice(0, 10);
      document.getElementById('invClient').value = '';
      document.getElementById('invAmount').value = '';
      document.getElementById('invStamp').value = '2.00';
      document.getElementById('invNotes').value = '';
      delBtn.style.display = 'none';
    }

    modal.classList.add('open');
  }

  function openCatModal(cat = null) {
    const modal = document.getElementById('catModal');
    const delBtn = document.getElementById('btnDeleteCat');

    if (cat) {
      document.getElementById('catModalTitle').textContent = 'Modifica Categoria';
      document.getElementById('catId').value = cat.id;
      document.getElementById('catType').value = cat.type;
      document.getElementById('catIcon').value = cat.icon || '💰';
      document.getElementById('catName').value = cat.name;
      document.getElementById('catDefaultBudget').value = cat.budget ? cat.budget[0] || 0 : 0;
      document.getElementById('catFlag').checked = Boolean(cat.flag);
      delBtn.style.display = 'inline-flex';
    } else {
      document.getElementById('catModalTitle').textContent = 'Nuova Categoria';
      document.getElementById('catId').value = '';
      document.getElementById('catType').value = state.catType;
      document.getElementById('catIcon').value = state.catType === 'REDDITO' ? '💰' : '🛒';
      document.getElementById('catName').value = '';
      document.getElementById('catDefaultBudget').value = 0;
      document.getElementById('catFlag').checked = true;
      delBtn.style.display = 'none';
    }

    modal.classList.add('open');
  }

  function switchView(viewName) {
    state.activeView = viewName;
    document.querySelectorAll('.bottom-nav .nav-btn').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-view') === viewName);
    });
    document.querySelectorAll('.app-view').forEach((sec) => {
      sec.style.display = sec.id === 'view-' + viewName ? 'block' : 'none';
    });
    renderAll();
  }

  function renderAll() {
    renderMonthStrip();
    if (state.activeView === 'monthly') renderMonthlyDashboard();
    else if (state.activeView === 'annual') renderAnnualDashboard();
    else if (state.activeView === 'transactions') renderTransactions();
    else if (state.activeView === 'taxes') renderTaxesView();
    else if (state.activeView === 'budget') renderBudget();
    else if (state.activeView === 'categories') renderCategories();
    else if (state.activeView === 'backup') {
      document.getElementById('headerSubtitle').textContent = `💾 SALVATAGGIO & BACKUP PC / CELLULARE`;
    }
  }

  function initYearSelector() {
    const years = new Set([2025, 2026, 2027]);
    state.data.transactions.forEach((t) => {
      if (t.date) {
        const y = parseInt(t.date.slice(0, 4), 10);
        if (!isNaN(y)) years.add(y);
      }
    });
    const sortedYears = Array.from(years).sort();
    const sel = document.getElementById('yearSelect');
    sel.innerHTML = sortedYears
      .map((y) => `<option value="${y}" ${y === state.selectedYear ? 'selected' : ''}>Anno ${y}</option>`)
      .join('');
    sel.addEventListener('change', () => {
      state.selectedYear = parseInt(sel.value, 10);
      renderAll();
    });
  }

  function applyVisualStyle(styleCode) {
    document.documentElement.setAttribute('data-style', styleCode);
    localStorage.setItem(STYLE_KEY, styleCode);
    document.querySelectorAll('#styleSwitcherBar .style-chip').forEach((btn) => {
      btn.classList.toggle('active', btn.getAttribute('data-style') === styleCode);
    });
  }

  function initEvents() {
    const savedStyle = localStorage.getItem(STYLE_KEY) || 'excel';
    applyVisualStyle(savedStyle);

    document.querySelectorAll('#styleSwitcherBar .style-chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyVisualStyle(btn.getAttribute('data-style'));
      });
    });

    // Quick Expense Form Submit (Tastiera Rapida)
    const qForm = document.getElementById('quickExpenseForm');
    if (qForm) {
      qForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const amtInput = document.getElementById('quickAmount');
        const noteInput = document.getElementById('quickNote');
        const amount = parseFloat(amtInput.value) || 0;
        if (amount <= 0) return;

        const today = new Date().toISOString().slice(0, 10);
        state.data.transactions.push({
          id: 'tx_' + Date.now(),
          date: today,
          type: 'SPESE',
          category: state.quickCat,
          description: noteInput.value.trim(),
          amount: amount
        });

        amtInput.value = '';
        noteInput.value = '';
        saveData(false);
        showToast(`⚡ Registrati ${fmtEuro(amount)} in ${state.quickCat}!`);
        renderAll();
      });
    }

    // Toggle Buttons for Live Comparison (Tastiera Rapida ON/OFF & Necessità/Sfizi ON/OFF)
    const btnToggleQuick = document.getElementById('btnToggleQuickBar');
    const btnToggleNeeds = document.getElementById('btnToggleNeedsBox');

    function updateFeatureTogglesUI() {
      const qCont = document.getElementById('quickExpenseContainer');
      const mNeeds = document.getElementById('monthlyNeedsCard');
      const aNeeds = document.getElementById('annualNeedsCard');

      if (qCont) qCont.style.display = state.showQuickBar ? 'block' : 'none';
      if (mNeeds) mNeeds.style.display = state.showNeedsBox ? 'block' : 'none';
      if (aNeeds) aNeeds.style.display = state.showNeedsBox ? 'block' : 'none';

      if (btnToggleQuick) {
        btnToggleQuick.textContent = `⚡ Tastiera Rapida: ${state.showQuickBar ? 'ON' : 'OFF'}`;
        btnToggleQuick.classList.toggle('active', state.showQuickBar);
      }
      if (btnToggleNeeds) {
        btnToggleNeeds.textContent = `⚖️ Necessità/Sfizi: ${state.showNeedsBox ? 'ON' : 'OFF'}`;
        btnToggleNeeds.classList.toggle('active', state.showNeedsBox);
      }
    }

    if (btnToggleQuick) {
      btnToggleQuick.addEventListener('click', () => {
        state.showQuickBar = !state.showQuickBar;
        updateFeatureTogglesUI();
        renderAll();
      });
    }
    if (btnToggleNeeds) {
      btnToggleNeeds.addEventListener('click', () => {
        state.showNeedsBox = !state.showNeedsBox;
        updateFeatureTogglesUI();
        renderAll();
      });
    }
    updateFeatureTogglesUI();

    // Bottom Navigation
    document.querySelectorAll('.bottom-nav .nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        switchView(btn.getAttribute('data-view'));
      });
    });

    // Monthly Type Tabs
    document.querySelectorAll('#monthlyTypeTabs .type-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.monthlyType = btn.getAttribute('data-type');
        document.querySelectorAll('#monthlyTypeTabs .type-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderCategoryBreakdownList('monthlyCategoryBreakdown', state.monthlyType, state.selectedMonth);
      });
    });

    // Annual Type Tabs
    document.querySelectorAll('#annualTypeTabs .type-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.annualType = btn.getAttribute('data-type');
        document.querySelectorAll('#annualTypeTabs .type-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderCategoryBreakdownList('annualCategoryBreakdown', state.annualType, 'ALL');
      });
    });

    // Budget Type Tabs
    document.querySelectorAll('#budgetTypeTabs .type-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.budgetType = btn.getAttribute('data-type');
        document.querySelectorAll('#budgetTypeTabs .type-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderBudget();
      });
    });

    // Categories Type Tabs
    document.querySelectorAll('#catTypeTabs .type-tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.catType = btn.getAttribute('data-type');
        document.querySelectorAll('#catTypeTabs .type-tab').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        renderCategories();
      });
    });

    // Tax simulator live parameters (scomposizione F24 dai PDF)
    ['taxCoeff', 'taxIrpefRate', 'taxInpsRate', 'taxJuneInps', 'taxJuneImp', 'taxJuneSaldo', 'taxJuneCredito', 'taxNovInps', 'taxNovImp'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.addEventListener('input', () => {
          state.data.taxSettings = {
            coeff: parseFloat(document.getElementById('taxCoeff').value) || 0,
            irpefRate: parseFloat(document.getElementById('taxIrpefRate').value) || 0,
            inpsRate: parseFloat(document.getElementById('taxInpsRate').value) || 0,
            june: {
              inps: parseFloat(document.getElementById('taxJuneInps').value) || 0,
              imposta: parseFloat(document.getElementById('taxJuneImp').value) || 0,
              saldoPrev: parseFloat(document.getElementById('taxJuneSaldo').value) || 0,
              credito: parseFloat(document.getElementById('taxJuneCredito').value) || 0
            },
            nov: {
              inps: parseFloat(document.getElementById('taxNovInps').value) || 0,
              imposta: parseFloat(document.getElementById('taxNovImp').value) || 0
            }
          };
          if (!state.data.taxPaidByYear) state.data.taxPaidByYear = {};
          state.data.taxPaidByYear[state.selectedYear] = JSON.parse(JSON.stringify(state.data.taxSettings));
          saveData(false);
          renderTaxesView();
        });
      }
    });

    // Invoice buttons
    document.getElementById('btnNewInvoice').addEventListener('click', () => openInvModal(null));
    document.getElementById('closeInvModal').addEventListener('click', () => {
      document.getElementById('invModal').classList.remove('open');
    });

    document.getElementById('invForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('invId').value;
      const number = document.getElementById('invNum').value.trim();
      const date = document.getElementById('invDate').value;
      const client = document.getElementById('invClient').value.trim();
      const amount = parseFloat(document.getElementById('invAmount').value) || 0;
      const stamp = parseFloat(document.getElementById('invStamp').value) || 0;
      const notes = document.getElementById('invNotes').value.trim();

      if (id) {
        const existing = state.data.invoices.find((i) => i.id === id);
        if (existing) {
          existing.number = number;
          existing.date = date;
          existing.client = client;
          existing.amount = amount;
          existing.stamp = stamp;
          existing.notes = notes;
        }
      } else {
        state.data.invoices.push({
          id: 'inv_' + Date.now(),
          number,
          date,
          client,
          amount,
          stamp,
          notes
        });
      }

      document.getElementById('invModal').classList.remove('open');
      saveData(true);
      renderTaxesView();
    });

    document.getElementById('btnDeleteInv').addEventListener('click', () => {
      const id = document.getElementById('invId').value;
      if (!id) return;
      if (confirm('Vuoi eliminare questa fattura dal simulatore fiscale?')) {
        state.data.invoices = state.data.invoices.filter((i) => i.id !== id);
        document.getElementById('invModal').classList.remove('open');
        state.data.explicitInvoiceClear = true;
        saveData(true);
        delete state.data.explicitInvoiceClear;
        renderTaxesView();
      }
    });

    // Import invoices from Condomini income transactions
    document.getElementById('btnImportInvoicesFromTx').addEventListener('click', () => {
      if (
        !confirm(
          `Vuoi generare un riepilogo fatture annuali raggruppando i compensi dei Condomini incassati nel ${state.selectedYear} (escludendo Stipendio Estella e Assegno/Entrate)? Potrai poi modificare o eliminare ogni singola riga.`
        )
      ) {
        return;
      }

      const yearTxs = getTransactionsFor('ALL').filter(
        (t) =>
          t.type === 'REDDITO' &&
          !t.category.toLowerCase().includes('estella') &&
          !t.category.toLowerCase().includes('consu')
      );

      const byCondo = {};
      yearTxs.forEach((t) => {
        if (!byCondo[t.category]) {
          byCondo[t.category] = { sum: 0, count: 0, lastDate: t.date };
        }
        byCondo[t.category].sum += Number(t.amount) || 0;
        byCondo[t.category].count += 1;
        if (t.date > byCondo[t.category].lastDate) byCondo[t.category].lastDate = t.date;
      });

      // Remove previous auto-imported invoices for this year to avoid duplicates
      state.data.invoices = state.data.invoices.filter(
        (i) => !(i.date && i.date.startsWith(String(state.selectedYear)) && i.autoImported)
      );

      let num = state.data.invoices.length + 1;
      Object.entries(byCondo).forEach(([condoName, info]) => {
        if (info.sum > 0) {
          state.data.invoices.push({
            id: 'inv_auto_' + Date.now() + '_' + num,
            number: `${num}/${state.selectedYear}`,
            date: info.lastDate || `${state.selectedYear}-11-01`,
            client: `Condominio ${condoName}`,
            amount: round2(info.sum),
            stamp: 2.0,
            notes: `Totale ${info.count} mensilità incassate nel ${state.selectedYear}`,
            autoImported: true
          });
          num++;
        }
      });

      state.data.explicitInvoiceClear = true;
      saveData(false);
      delete state.data.explicitInvoiceClear;
      showToast('✅ Compensi condomini importati nel simulatore tasse!');
      renderTaxesView();
    });

    function round2(n) {
      return Math.round((Number(n) || 0) * 100) / 100;
    }

    // Transaction filters
    document.getElementById('txSearch').addEventListener('input', renderTransactions);
    document.getElementById('txTypeFilter').addEventListener('change', () => {
      document.getElementById('txCatFilter').value = 'ALL';
      renderTransactions();
    });
    document.getElementById('txCatFilter').addEventListener('change', renderTransactions);

    // Batch Load Monthly Income
    document.getElementById('btnBatchIncome').addEventListener('click', () => {
      const mIdx = state.txMonthFilter === 'ALL' ? state.selectedMonth : state.txMonthFilter;
      const mName = MONTHS[mIdx].full;
      if (
        !confirm(
          `Vuoi inserire automaticamente tutte le voci di REDDITO previste a budget per ${mName} ${state.selectedYear} non ancora registrate?`
        )
      ) {
        return;
      }

      const monthStr = String(mIdx + 1).padStart(2, '0');
      const dateStr = `${state.selectedYear}-${monthStr}-01`;
      const existingIncomes = new Set(
        state.data.transactions
          .filter(
            (t) =>
              t.type === 'REDDITO' &&
              t.date &&
              t.date.startsWith(`${state.selectedYear}-${monthStr}`)
          )
          .map((t) => t.category)
      );

      let added = 0;
      state.data.categories
        .filter((c) => c.type === 'REDDITO')
        .forEach((c) => {
          const bVal = Number(c.budget && c.budget[mIdx]) || 0;
          if (bVal > 0 && !existingIncomes.has(c.name)) {
            state.data.transactions.push({
              id: 'tx_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
              date: dateStr,
              type: 'REDDITO',
              category: c.name,
              description: `Reddito ${mName}`,
              amount: bVal
            });
            added++;
          }
        });

      saveData(false);
      showToast(`✅ Aggiunti ${added} redditi per ${mName}`);
      renderAll();
    });

    // Open Transaction Modal
    document.getElementById('fabAddTx').addEventListener('click', () => openTxModal(null, 'SPESE'));
    document.getElementById('btnNewTxTop').addEventListener('click', () => openTxModal(null, 'SPESE'));
    document.getElementById('closeTxModal').addEventListener('click', () => {
      document.getElementById('txModal').classList.remove('open');
    });

    document.querySelectorAll('#txFormTypeSelector .type-choice').forEach((el) => {
      el.addEventListener('click', () => {
        setModalType(el.getAttribute('data-type'));
      });
    });

    // Save Transaction
    document.getElementById('txForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('txId').value;
      const date = document.getElementById('txDate').value;
      const amount = parseFloat(document.getElementById('txAmount').value) || 0;
      const category = document.getElementById('txCategory').value;
      const description = document.getElementById('txDescription').value.trim();
      const type = state.txModalType;

      if (id) {
        const existing = state.data.transactions.find((t) => t.id === id);
        if (existing) {
          existing.date = date;
          existing.amount = amount;
          existing.category = category;
          existing.description = description;
          existing.type = type;
        }
      } else {
        state.data.transactions.push({
          id: 'tx_' + Date.now(),
          date,
          type,
          category,
          description,
          amount
        });
      }

      document.getElementById('txModal').classList.remove('open');
      saveData(true);
      initYearSelector();
      renderAll();
    });

    // Delete Transaction
    document.getElementById('btnDeleteTx').addEventListener('click', () => {
      const id = document.getElementById('txId').value;
      if (!id) return;
      if (confirm('Vuoi eliminare questo movimento?')) {
        state.data.transactions = state.data.transactions.filter((t) => t.id !== id);
        document.getElementById('txModal').classList.remove('open');
        saveData(true);
        renderAll();
      }
    });

    // Category Modal Events
    document.getElementById('btnNewCategory').addEventListener('click', () => openCatModal(null));
    document.getElementById('closeCatModal').addEventListener('click', () => {
      document.getElementById('catModal').classList.remove('open');
    });

    document.getElementById('catForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const id = document.getElementById('catId').value;
      const type = document.getElementById('catType').value;
      const icon = document.getElementById('catIcon').value.trim() || '📌';
      const name = document.getElementById('catName').value.trim();
      const defB = parseFloat(document.getElementById('catDefaultBudget').value) || 0;
      const flag = document.getElementById('catFlag').checked;

      if (!name) return;

      if (id) {
        const existing = state.data.categories.find((c) => c.id === id);
        if (existing) {
          const oldName = existing.name;
          const oldType = existing.type;
          existing.type = type;
          existing.icon = icon;
          existing.name = name;
          existing.flag = flag;
          if (oldName !== name || oldType !== type) {
            state.data.transactions.forEach((t) => {
              if (t.type === oldType && t.category === oldName) {
                t.type = type;
                t.category = name;
              }
            });
          }
        }
      } else {
        state.data.categories.push({
          id: 'cat_' + Date.now(),
          type,
          name,
          icon,
          flag,
          budget: new Array(12).fill(defB)
        });
      }

      document.getElementById('catModal').classList.remove('open');
      saveData(true);
      renderAll();
    });

    document.getElementById('btnDeleteCat').addEventListener('click', () => {
      const id = document.getElementById('catId').value;
      if (!id) return;
      const cat = state.data.categories.find((c) => c.id === id);
      if (!cat) return;
      if (confirm(`Vuoi eliminare la categoria "${cat.name}"?`)) {
        state.data.categories = state.data.categories.filter((c) => c.id !== id);
        document.getElementById('catModal').classList.remove('open');
        saveData(true);
        renderAll();
      }
    });

    // Backup & Restore Actions
    document.getElementById('btnExportJson').addEventListener('click', () => {
      const dateTag = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(state.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Salvataggio_Contabilita_Giuseppe_${dateTag}.json`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('📥 File di salvataggio scaricato!');
    });

    document.getElementById('btnImportJson').addEventListener('click', () => {
      document.getElementById('fileImportJson').click();
    });

    document.getElementById('fileImportJson').addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (parsed && Array.isArray(parsed.categories) && Array.isArray(parsed.transactions)) {
            state.data = parsed;
            ensureDataIntegrity();
            saveData(false);
            initYearSelector();
            renderAll();
            showToast('✅ Salvataggio ripristinato con successo!');
          } else {
            alert('Il file selezionato non è un file di salvataggio valido.');
          }
        } catch (err) {
          alert('Errore durante la lettura del file JSON.');
        }
      };
      reader.readAsText(file);
    });

    document.getElementById('btnExportCsv').addEventListener('click', () => {
      const rows = [['Data', 'Tipo', 'Categoria', 'Descrizione', 'Importo']];
      state.data.transactions.forEach((t) => {
        rows.push([
          t.date || '',
          t.type || '',
          `"${(t.category || '').replace(/"/g, '""')}"`,
          `"${(t.description || '').replace(/"/g, '""')}"`,
          String(t.amount || 0).replace('.', ',')
        ]);
      });
      const csvContent = '\uFEFF' + rows.map((r) => r.join(';')).join('\r\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Transazioni_Giuseppe_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast('📊 File CSV per Excel scaricato!');
    });

    document.getElementById('btnResetOriginal').addEventListener('click', () => {
      if (
        confirm(
          'Vuoi ricaricare i dati iniziali? Eventuali modifiche non esportate andranno perse.'
        )
      ) {
        if (window.ENCRYPTED_CONTABILITA_B64) {
          // GitHub PWA version: decrypt the real dataset with the saved PIN
          const savedPin = localStorage.getItem('contabilita_ga_pin_v1') || prompt('Inserisci il tuo PIN per ricaricare i dati:');
          if (!savedPin) return;
          decryptPayloadWithPin(savedPin).then((unlocked) => {
            if (unlocked) {
              localStorage.setItem('contabilita_ga_pin_v1', savedPin);
              state.data = JSON.parse(JSON.stringify(unlocked));
              ensureDataIntegrity();
              saveData(false);
              initYearSelector();
              renderAll();
              showToast('🔄 Dati originali ripristinati!');
              syncWithServerOnStartup();
            } else {
              alert('PIN errato: impossibile ripristinare.');
            }
          });
        } else {
          state.data = JSON.parse(JSON.stringify(window.DEFAULT_CONTABILITA_DATA));
          ensureDataIntegrity();
          saveData(false);
          initYearSelector();
          renderAll();
          showToast('🔄 Dati originali Excel 2026 ripristinati!');
        }
      }
    });
  }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }

  loadData();
  initYearSelector();
  initEvents();
  renderAll();
  initPersonalPinGate();
  syncWithServerOnStartup();

  const syncBadgeEl = document.getElementById('syncStatusBadge');
  if (syncBadgeEl) {
    syncBadgeEl.addEventListener('click', () => {
      syncWithServerOnStartup();
      showToast('🔄 Controllo sincronizzazione PC (J: e D:)...');
    });
  }
})();
