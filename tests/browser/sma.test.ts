import { trackSmaNetwork } from "../../server/scrapers/sma-network";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { waitForSmaChart, collectSmaDiagnostics, loginSma, readSmaDailyHistory } from "../../server/scrapers/sma-browser";

let browser: Browser;
before(async () => { browser = await chromium.launch({ headless: true }); });
after(async () => { await browser?.close(); });

const chart = `
<main>
  <div role="combobox" id="resolution" tabindex="0" onclick="document.getElementById('monthOption').hidden=false">Day</div>
  <div id="monthOption" role="option" hidden onclick="this.hidden=true;document.getElementById('resolution').textContent='Month';setTimeout(showEnergy,200)">Month</div>
  <div role="combobox" aria-disabled="true">September</div>
  <div role="combobox" aria-disabled="true">2026</div>
  <button aria-expanded="false" onclick="this.setAttribute('aria-expanded','true');document.getElementById('details').hidden=false">Details</button>
  <div role="region" aria-label="Details" id="details" hidden>
    <div role="table" id="table">
      <div role="row">Time period Power [kW]</div>
      <div role="row"><span role="cell">09/10/2026</span><span role="cell">999.99</span></div>
    </div>
  </div>
</main>
<script>
function showEnergy() {
  document.getElementById('table').innerHTML = '<div role="row"><span role="columnheader">Time period</span><span role="columnheader">Total yield [kWh]</span></div>'
    + '<div role="row"><span role="cell">09/09/2026</span><span role="cell">3,193.66</span></div>'
    + '<div role="row"><span role="cell">09/10/2026</span><span role="cell">0.00</span></div>';
}
</script>`;

test("SMA reader waits for energy table, preserving zero and local dates", async () => {
  const context = await browser.newContext();
  await context.route("**/*", route => route.abort());
  try {
    const page = await context.newPage();
    await page.setContent(chart);
    const readings = await readSmaDailyHistory(page, { id: 7, timezone: "America/New_York" }, {
      start: new Date("2026-09-09T18:00:00Z"), end: new Date("2026-09-10T18:00:00Z"),
    });
    assert.equal(readings.length, 2);
    assert.equal(readings[0].energyWh, 3193660);
    assert.equal(readings[1].energyWh, 0);
    assert.equal(readings[0].timestamp.toISOString(), "2026-09-09T04:00:00.000Z");
  } finally { await context.close(); }
});

test("SMA login starts at portal and follows fresh SMA ID redirect", async () => {
  const context = await browser.newContext();
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    const body = url.origin === "https://login.sma.energy"
      ? `<label>E-mail or user name<input id="user"></label><input type="password" id="pass"><button onclick="if(document.getElementById('user').value==='fixture-user' && document.getElementById('pass').value==='fixture-secret') location.href='https://ennexos.sunnyportal.com/123/dashboard'">Log in</button>`
      : url.pathname === "/123/dashboard" ? '<button>User settings</button>'
      : `<button onclick="this.remove()">Reject all</button><button onclick="location.href='https://login.sma.energy/auth?state=fresh&redirect_uri=https://ennexos.sunnyportal.com/123/dashboard'">Login</button>`;
    await route.fulfill({ contentType: "text/html", body });
  });
  try {
    const page = await context.newPage();
    await loginSma(page, "fixture-user", "fixture-secret", 5000);
    assert.equal(new URL(page.url()).pathname, "/123/dashboard");
  } finally { await context.close(); }
});

test("SMA failed login never includes credentials or OAuth query in errors", async () => {
  const context = await browser.newContext();
  await context.route("**/*", route => route.fulfill({ contentType: "text/html", body: `<button onclick="location.href='https://login.sma.energy/auth?code=private-oauth'">Login</button>` }));
  try {
    const page = await context.newPage();
    await assert.rejects(loginSma(page, "fixture-user", "fixture-secret", 1000), error => {
      assert.match(String(error), /SMA login failed/);
      assert.doesNotMatch(String(error), /fixture-user|fixture-secret|private-oauth/);
      return true;
    });
  } finally { await context.close(); }
});

test("SMA reads controls outside a main landmark and waits for month updates", async () => {
  const context = await browser.newContext();
  await context.route("**/*", route => route.abort());
  try {
    const page = await context.newPage();
    await page.setContent(chart.replace('<main>', '<div>').replace('</main>', '</div>').replace('<div role="combobox" aria-disabled="true">September</div>', `
      <div role="combobox" id="monthControl" tabindex="0" onclick="document.getElementById('months').hidden=false" onkeydown="if(event.key==='Escape')document.getElementById('months').hidden=true">September</div>
      <div id="months" hidden>
        <div role="option" onclick="pickMonth('August')">August</div>
        <div role="option" onclick="pickMonth('September')">September</div>
      </div>`).replace('</script>', `
      function pickMonth(month) {
        document.getElementById('months').hidden=true;
        document.getElementById('monthControl').textContent=month;
        setTimeout(() => {
          document.getElementById('table').innerHTML='<div role="row"><span role="columnheader">Time period</span><span role="columnheader">Total yield [kWh]</span></div><div role="row"><span role="cell">'+(month==='August'?'08/31/2026':'09/10/2026')+'</span><span role="cell">'+(month==='August'?'1.23':'4.56')+'</span></div>';
        }, 400);
      }
      </script>`));
    const readings = await readSmaDailyHistory(page, { id: 7, timezone: "UTC" }, {
      start: new Date("2026-08-01T00:00:00Z"), end: new Date("2026-09-10T18:00:00Z"),
    });
    assert.deepEqual(readings.map(r => [r.timestamp.toISOString(), r.energyWh]), [
      ["2026-08-31T00:00:00.000Z", 1230], ["2026-09-10T00:00:00.000Z", 4560],
    ]);
  } finally { await context.close(); }
});

test("SMA diagnostics report hidden controls without leaking portal text", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent('<div aria-hidden="true"><div role="combobox">Day</div></div><div role="combobox" style="display:none">private-secret</div><div role="dialog">private-account</div><p>No data available</p>');
    const diagnostics = await collectSmaDiagnostics(page);
    assert.equal(diagnostics.comboboxes, 2);
    assert.equal(diagnostics.visibleComboboxes, 1);
    assert.equal(diagnostics.controls[0].hiddenFromAccessibility, true);
    assert.equal(diagnostics.signals.noData, true);
    assert.equal(diagnostics.dialogs, 1);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private-secret|private-account/);
  } finally { await page.close(); }
});

for (const recover of [true, false]) {
  test(`SMA chart readiness reloads once; recovery=${recover}`, async () => {
    const context = await browser.newContext();
    let loads = 0;
    await context.route("**/*", route => {
      loads++;
      return route.fulfill({ contentType: "text/html", body: recover && loads === 2
        ? '<div role="combobox">Day</div>'
        : '<h1>Energy and power - PV</h1><div role="progressbar"></div>' });
    });
    try {
      const page = await context.newPage();
      await page.goto("https://ennexos.sunnyportal.com/123/monitoring/view-energy-and-power");
      if (recover) await waitForSmaChart(page, "123", 300);
      else await assert.rejects(waitForSmaChart(page, "123", 300), /after one reload/);
      assert.equal(loads, 2);
    } finally { await context.close(); }
  });
}

test("SMA chart recovery refuses a different system", async () => {
  const context = await browser.newContext();
  await context.route("**/*", route => route.fulfill({body: '<div role="combobox">Day</div>'}));
  try {
    const page = await context.newPage();
    await page.goto("https://ennexos.sunnyportal.com/456/monitoring/view-energy-and-power");
    await assert.rejects(waitForSmaChart(page, "123", 300), /requested system/);
  } finally { await context.close(); }
});

test("SMA network diagnostics identify unfinished requests without URL secrets", async () => {
  const context = await browser.newContext();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await context.route("**/*", async route => {
    if (route.request().url().includes("private-token")) {
      await gate;
      await route.fulfill({ body: "ok" });
    } else await route.fulfill({ contentType: "text/html", body: '<script>fetch("/private-account?token=private-token")</script>' });
  });
  const page = await context.newPage();
  const tracker = trackSmaNetwork(page);
  try {
    const started = page.waitForEvent("request", request => request.resourceType() === "fetch");
    await page.goto("https://ennexos.sunnyportal.com/");
    await started;
    const snapshot = tracker.snapshot();
    assert.equal(snapshot.pendingCount, 1);
    assert.equal(snapshot.pending[0].destination, "portal");
    assert.equal(snapshot.pending[0].type, "fetch");
    assert.doesNotMatch(JSON.stringify(snapshot), /private-account|private-token/);
    const completed = page.waitForEvent("requestfinished", request => request.resourceType() === "fetch");
    release();
    await completed;
    assert.equal(tracker.snapshot().pendingCount, 0);
  } finally { release(); tracker.dispose(); await context.close(); }
});

test("SMA desktop tabs read month/year controls without a resolution dropdown", async () => {
  const page = await browser.newPage();
  try {
    const desktop = chart.replace(/<div role="combobox" id="resolution"[^\n]+\n/, '')
      .replace(/<div id="monthOption"[^\n]+\n/, '<button role="tab" onclick="setTimeout(showEnergy,200)">Month</button>\n')
      .replace('<div role="combobox" aria-disabled="true">September</div>', `<div role="combobox" tabindex="0" onclick="this.innerHTML='September &lt;span role=option&gt;September&lt;/span&gt;'" onkeydown="if(event.key==='Escape')this.textContent='September'">September</div>`);
    await page.setContent(desktop);
    const rows = await readSmaDailyHistory(page, {id:7,timezone:"UTC"}, {
      start:new Date("2026-09-09T00:00:00Z"),end:new Date("2026-09-10T23:59:00Z"),
    });
    assert.equal(rows.length,2);
    assert.equal(rows[0].energyWh,3193660);
  } finally {await page.close();}
});

// Month rollover: the default month has no production yet, but the previous
// month's data must still be fetched. Freeze the browser and Node month to the
// current calendar month by constructing the fixture dynamically.
test("SMA empty current month does not block historical readings", async () => {
  const page = await browser.newPage();
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.toLocaleString('en-US', {month:'long',timeZone:'UTC'});
  const previous = new Date(Date.UTC(currentYear, now.getUTCMonth() - 1, 1));
  const previousMonth = previous.toLocaleString('en-US', {month:'long',timeZone:'UTC'});
  const previousYear = previous.getUTCFullYear();
  const date = `${String(previous.getUTCMonth()+1).padStart(2,'0')}/01/${previousYear}`;
  try {
    await page.setContent(`
      <div role="progressbar" aria-label="Unrelated stale spinner"></div><button role="tab">Month</button>
      <div role="combobox" id="month" tabindex="0" onclick="months.hidden=false" onkeydown="if(event.key==='Escape')months.hidden=true">${currentMonth}</div>
      <div role="combobox" id="year" tabindex="0" onclick="years.hidden=false" onkeydown="if(event.key==='Escape')years.hidden=true">${currentYear}</div>
      <div id="months" hidden>${[...new Set([previousMonth,currentMonth])].map(m=>`<div role="option" onclick="selectMonth('${m}')">${m}</div>`).join('')}</div>
      <div id="years" hidden>${[...new Set([previousYear,currentYear])].map(y=>`<div role="option" onclick="year.textContent='${y}';years.hidden=true">${y}</div>`).join('')}</div>
      <button aria-expanded="true">Details</button>
      <div role="region" aria-label="Details" id="details">No data available</div>
      <script>
      function selectMonth(value) {
        month.textContent=value;months.hidden=true;
        details.setAttribute('aria-busy','true');
        setTimeout(()=>{
          details.innerHTML=value==='${previousMonth}'
            ? '<table><tr><th>Total yield [kWh]</th></tr><tr><td>${date}</td><td>2.5</td></tr></table>'
            : 'No data available';
          details.removeAttribute('aria-busy');
        },100);
      }
      </script>`);
    const rows = await readSmaDailyHistory(page, {id:7,timezone:'UTC'}, {start:previous,end:now}, 1500);
    assert.equal(rows.length,1);
    assert.equal(rows[0].energyWh,2500);
    assert.equal(rows[0].timestamp.toISOString(),previous.toISOString());
  } finally { await page.close(); }
});

for (const recover of [true, false]) {
  test(`SMA stalled energy transition retries once and then recovery=${recover}`, async () => {
    const { readSmaHistoryWithRecovery } = await import('../../server/scrapers/sma-browser');
    const context = await browser.newContext();
    let loads = 0;
    await context.route('**/*', route => {
      loads++;
      return route.fulfill({contentType:'text/html',body:recover && loads === 2 ? chart : chart.replace('setTimeout(showEnergy,200)','void 0')});
    });
    try {
      const page = await context.newPage();
      await page.goto('https://ennexos.sunnyportal.com/123/monitoring/view-energy-and-power');
      const result = readSmaHistoryWithRecovery(page,{id:7,timezone:'UTC'}, {
        start:new Date('2026-09-09T00:00:00Z'),end:new Date('2026-09-10T23:59:00Z'),
      },'123',800);
      if(recover) assert.equal((await result).length,2);
      else await assert.rejects(result,{name:'TimeoutError'});
      assert.equal(loads,2);
    } finally {await context.close();}
  });
}

test("SMA empty historical month still fails instead of fabricating zero", async () => {
  const page = await browser.newPage();
  try {
    await page.setContent(chart.replace('setTimeout(showEnergy,200)', "document.getElementById('table').remove();document.getElementById('details').textContent='No data available'"));
    await assert.rejects(readSmaDailyHistory(page,{id:7,timezone:'UTC'}, {
      start:new Date('2026-09-09T00:00:00Z'),end:new Date('2026-09-10T23:59:00Z'),
    },300),{name:'TimeoutError'});
  } finally {await page.close();}
});

test("SMA validation failures are not retried", async () => {
  const { readSmaHistoryWithRecovery } = await import('../../server/scrapers/sma-browser');
  const context = await browser.newContext();
  let loads=0;
  await context.route('**/*', route => {
    loads++;
    return route.fulfill({contentType:'text/html',body:chart.replace('3,193.66','invalid')});
  });
  try {
    const page=await context.newPage();
    await page.goto('https://ennexos.sunnyportal.com/123/monitoring/view-energy-and-power');
    await assert.rejects(readSmaHistoryWithRecovery(page,{id:7,timezone:'UTC'}, {
      start:new Date('2026-09-09T00:00:00Z'),end:new Date('2026-09-10T23:59:00Z'),
    },'123',800),/daily yield is missing or invalid/);
    assert.equal(loads,1);
  } finally {await context.close();}
});
