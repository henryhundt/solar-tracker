import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser } from "playwright";
import { loginSma, readSmaDailyHistory } from "../../server/scrapers/sma-browser";

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
