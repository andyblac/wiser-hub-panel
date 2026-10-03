const assert = require("node:assert/strict");
const path = require("node:path");
const {chromium} = require("playwright");

const root = path.resolve(__dirname, "..");

function fixtureData() {
  const entries = [];
  const states = {};
  const add = (entityId, value, attributes = {}) => {
    entries.push({
      entity_id:entityId,
      platform:"wiser",
      config_entry_id:"hub-a",
      device_id:"device-a",
    });
    states[entityId] = {
      entity_id:entityId,
      state:String(value),
      attributes,
      last_changed:"2026-10-02T08:00:00Z",
    };
  };
  for (let index = 0; index < 28; index += 1) {
    add(`sensor.reading_${index}`, index, {friendly_name:`Reading ${index}`});
  }
  for (let index = 0; index < 10; index += 1) {
    add(`sensor.battery_${index}`, index === 0 ? 10 : 80 - index, {
      device_class:"battery",
      friendly_name:`Battery ${index}`,
    });
  }
  for (let index = 0; index < 8; index += 1) {
    add(`switch.output_${index}`, "off", {friendly_name:`Output ${index}`});
  }
  add("sensor.temperature", 20, {
    device_class:"temperature",
    friendly_name:"Hub temperature",
  });
  return {entries, states};
}

(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:900, height:600}});
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await page.setContent(`<!doctype html>
      <style>
        html, body { height: 100%; margin: 0; }
        wiser-hub-panel { display: block; height: 100%; }
      </style>
      <wiser-hub-panel></wiser-hub-panel>`);
    await page.addScriptTag({path:path.join(root, "dist/wiser-hub-panel.js")});
    const fixture = fixtureData();
    await page.evaluate(({entries, states}) => {
      for (const name of ["ha-icon", "ha-state-icon", "state-display"]) {
        if (!customElements.get(name)) customElements.define(name, class extends HTMLElement {});
      }
      const panel = document.querySelector("wiser-hub-panel");
      const devices = [
        {
          id:"device-a",
          config_entries:["hub-a"],
          manufacturer:"Drayton",
          model:"HubR",
        },
        {
          id:"device-b",
          config_entries:["hub-b"],
          manufacturer:"Drayton",
          model:"HubR",
        },
      ];
      const hass = {
        language:"en-GB",
        locale:{language:"en-GB"},
        user:{is_admin:true},
        states,
        formatEntityName:state => state.attributes.friendly_name || state.entity_id,
        formatEntityState:state => state.state,
        callWS:async ({type}) => ({
          "config/entity_registry/list":entries,
          "config/device_registry/list":devices,
        })[type],
        callApi:async () => [],
        callService:async () => {},
      };
      panel.hass = hass;
      panel.panel = {
        config:{hubs:["Home", "Workshop"], hub_ids:{Home:"hub-a", Workshop:"hub-b"}},
      };
      window.fixture = {panel, hass};
    }, fixture);

    await page.locator("wiser-hub-panel .entity-row").first().waitFor();
    const panel = page.locator("wiser-hub-panel");
    const tabs = page.getByRole("tab");
    assert.equal(await tabs.count(), 2);
    assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "true");
    await tabs.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document
      .querySelector("wiser-hub-panel")
      ?.shadowRoot.querySelector('[data-hub="Workshop"]')
      ?.getAttribute("aria-selected") === "true");
    assert.equal(await tabs.nth(1).getAttribute("aria-selected"), "true");
    assert.equal(
      await panel.evaluate(element => element.shadowRoot.activeElement?.dataset.hub),
      "Workshop",
    );
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document
      .querySelector("wiser-hub-panel")
      ?.shadowRoot.querySelector('[data-hub="Home"]')
      ?.getAttribute("aria-selected") === "true");
    await page.locator("wiser-hub-panel .entity-row").first().waitFor();
    assert.equal(await tabs.nth(0).getAttribute("aria-selected"), "true");
    const attention = page.getByRole("button", {name:"Show what needs attention"});
    assert.equal(await attention.locator("strong").textContent(), "1");
    const attentionDetails = page.locator("wiser-hub-panel #attention-details");
    assert.equal(await attentionDetails.isHidden(), true);
    await attention.click();
    assert.equal(await attentionDetails.isVisible(), true);
    assert.equal(
      await panel.evaluate(element => element.shadowRoot.activeElement?.id),
      "attention-details",
    );
    assert.match(
      await attentionDetails.textContent(),
      /Battery 0 \(10\)/,
    );
    await page.locator('wiser-hub-panel [data-action="attention"]').click();
    assert.equal(await attentionDetails.isHidden(), true);
    assert.ok(await panel.evaluate(element => element.scrollHeight > element.clientHeight));

    const firstGroup = page.locator("wiser-hub-panel details.entity-group").first();
    await firstGroup.evaluate(element => { element.open = false; });
    await panel.evaluate(element => { element.scrollTop = 520; });
    const before = await panel.evaluate(element => element.scrollTop);
    assert.ok(before > 0);

    await page.evaluate(() => {
      const {panel:element, hass} = window.fixture;
      const previous = hass.states["sensor.reading_20"];
      const nextState = {...previous, state:"21", last_changed:new Date().toISOString()};
      const nextHass = {
        ...hass,
        states:{...hass.states, [nextState.entity_id]:nextState},
      };
      window.fixture.hass = nextHass;
      element.hass = nextHass;
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

    const after = await panel.evaluate(element => element.scrollTop);
    assert.ok(Math.abs(after - before) <= 1, `scroll changed from ${before} to ${after}`);
    assert.equal(await firstGroup.evaluate(element => element.open), false);

    const search = page.getByRole("searchbox", {name:"Find a hub control or sensor…"});
    await search.fill("reading 2");
    assert.equal(await search.inputValue(), "reading 2");
    assert.equal(
      await panel.evaluate(element => element.shadowRoot.activeElement?.id),
      "search",
    );
    assert.equal(await page.getByRole("img", {name:/24-hour history for Hub temperature/}).count(), 1);
    await page.setViewportSize({width:375, height:700});
    const diagnostics = page.getByRole("button", {name:"Download diagnostics"});
    const diagnosticsLayout = await diagnostics.evaluate(element => ({
      width:element.getBoundingClientRect().width,
      labelDisplay:getComputedStyle(element.querySelector(".diagnostics-label")).display,
      position:getComputedStyle(element).position,
    }));
    assert.equal(diagnosticsLayout.width, 44);
    assert.equal(diagnosticsLayout.labelDisplay, "none");
    assert.equal(diagnosticsLayout.position, "absolute");
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
