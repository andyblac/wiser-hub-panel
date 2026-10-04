const assert = require("node:assert/strict");
const path = require("node:path");
const {chromium} = require("playwright");

const root = path.resolve(__dirname, "..");
const packageVersion = require(path.join(root, "package.json")).version;

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
  entries.push({
    entity_id:"sensor.disabled_control",
    platform:"wiser",
    config_entry_id:"hub-a",
    device_id:"device-a",
    disabled_by:"user",
    name:"Disabled control",
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
        {
          id:"device-disabled",
          config_entries:["hub-a"],
          via_device_id:"device-a",
          name:"Disabled thermostat",
          model:"Room thermostat",
          disabled_by:"user",
        },
      ];
      const hass = {
        language:"en-GB",
        locale:{language:"en-GB"},
        user:{is_admin:true},
        states,
        formatEntityName:state => state.attributes.friendly_name || state.entity_id,
        formatEntityState:state => state.state,
        callWS:async message => {
          window.fixtureCalls.push(message);
          return ({
            "config/entity_registry/list":entries,
            "config/device_registry/list":devices,
            "wiser/panel/configure":{},
          })[message.type];
        },
        callApi:async () => [],
        callService:async () => {},
      };
      window.fixtureCalls = [];
      panel.hass = hass;
      panel.panel = {
        config:{
          panel_id:"registry-panel",
          hubs:["Home", "Workshop"],
          hub_ids:{Home:"hub-a", Workshop:"hub-b"},
          card_configs:{},
        },
      };
      window.moreInfoEntity = null;
      panel.addEventListener("hass-more-info", event => {
        window.moreInfoEntity = event.detail.entityId;
      });
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
    const disabledDevices = page.getByRole("button", {name:"Show disabled devices"});
    const disabledDeviceDetails = page.locator("wiser-hub-panel #disabled-devices-details");
    assert.equal(await disabledDeviceDetails.isHidden(), true);
    await disabledDevices.click();
    assert.equal(await disabledDeviceDetails.isVisible(), true);
    assert.match(await disabledDeviceDetails.textContent(), /Disabled thermostat/);
    assert.equal(
      await disabledDeviceDetails.getByRole("link", {name:"Details: Disabled thermostat"}).getAttribute("href"),
      "/config/devices/device/device-disabled",
    );
    await page.locator('wiser-hub-panel [data-action="disabled-devices"]').click();
    assert.equal(await disabledDeviceDetails.isHidden(), true);

    const disabledEntities = page.getByRole("button", {name:"Show disabled entities"});
    const disabledEntityDetails = page.locator("wiser-hub-panel #disabled-entities-details");
    assert.equal(await disabledEntityDetails.isHidden(), true);
    await disabledEntities.click();
    assert.equal(await disabledEntityDetails.isVisible(), true);
    assert.match(await disabledEntityDetails.textContent(), /Disabled control/);
    await disabledEntityDetails.getByRole("button", {name:"Details: Disabled control"}).click();
    assert.equal(await page.evaluate(() => window.moreInfoEntity), "sensor.disabled_control");
    await page.locator('wiser-hub-panel [data-action="disabled-entities"]').click();
    assert.equal(await disabledEntityDetails.isHidden(), true);
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
    await tabs.nth(1).click();
    await tabs.nth(0).click();
    await page.locator("wiser-hub-panel details.entity-group").first().waitFor();
    assert.equal(await page.locator("wiser-hub-panel details.entity-group").first()
      .evaluate(element => element.open), false);

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
      actionsPosition:getComputedStyle(element.parentElement).position,
    }));
    assert.equal(diagnosticsLayout.width, 44);
    assert.equal(diagnosticsLayout.labelDisplay, "none");
    assert.equal(diagnosticsLayout.actionsPosition, "absolute");

    assert.equal(await page.locator('wiser-hub-panel [data-action="settings"]').count(), 0);
    await panel.evaluate(element => element._openEditor());
    const editor = page.locator("wiser-hub-panel #config-dialog");
    assert.equal(await editor.evaluate(element => element.open), true);
    assert.ok((await editor.textContent()).includes(`Wiser Hub Panel · ${packageVersion}`));
    assert.equal(await editor.locator(".hub-editor").count(), 2);
    assert.deepEqual(
      await editor.locator(".hub-editor > h2").allTextContents(),
      ["Home", "Workshop"],
    );
    const editorHubTabs = editor.getByRole("tab");
    assert.equal(await editorHubTabs.count(), 2);
    assert.equal(await editorHubTabs.nth(0).getAttribute("aria-selected"), "true");
    assert.equal(await editor.locator('.hub-editor[data-hub="Home"]').isVisible(), true);
    assert.equal(await editor.locator('.hub-editor[data-hub="Workshop"]').isVisible(), false);
    await editor.locator(".config-editor").evaluate(element => { element.scrollTop = 100; });
    await editorHubTabs.nth(1).click();
    assert.equal(await editorHubTabs.nth(1).getAttribute("aria-selected"), "true");
    assert.equal(await editor.locator(".config-editor").evaluate(element => element.scrollTop), 0);
    assert.equal(await editor.locator('.hub-editor[data-hub="Home"]').isVisible(), false);
    assert.equal(await editor.locator('.hub-editor[data-hub="Workshop"]').isVisible(), true);
    await editorHubTabs.nth(0).click();
    assert.equal(await editor.locator('[data-action="editor-cancel"]').evaluate(element => element.tagName), "HA-BUTTON");
    assert.equal(await editor.locator('[data-action="editor-cancel"]').getAttribute("appearance"), "plain");
    assert.equal(await editor.locator('[data-action="editor-save"]').evaluate(element => element.tagName), "HA-BUTTON");
    assert.equal(
      await editor.locator('[data-action="visibility-section"]').first().evaluate(element => element.tagName),
      "HA-SWITCH",
    );
    assert.equal(await editor.locator('ha-checkbox[data-action="visibility-section"]').count(), 0);
    const editorOverflow = await editor.locator(".config-editor").evaluate(element => ({
      clientWidth:element.clientWidth,
      scrollWidth:element.scrollWidth,
      overflowX:getComputedStyle(element).overflowX,
    }));
    assert.equal(editorOverflow.overflowX, "hidden");
    assert.ok(editorOverflow.scrollWidth <= editorOverflow.clientWidth);
    assert.equal(await editor.locator(".dialog-actions .editor-version").count(), 1);
    const entitySections = editor.locator(".entity-visibility-section");
    assert.ok(await entitySections.count() >= 3);
    assert.equal(await entitySections.first().evaluate(element => element.tagName), "HA-EXPANSION-PANEL");
    assert.equal(await entitySections.evaluateAll(elements => elements.every(element => element.expanded === false)), true);
    assert.equal(
      await editor.locator('[data-action="visibility-entity"][data-value="sensor.reading_0"]')
        .evaluate(element => element.closest(".entity-visibility-section")?.dataset.group),
      "sensors",
    );
    await page.evaluate(() => {
      const {panel, hass} = window.fixture;
      window.fixtureEditor = panel.shadowRoot.querySelector("#config-dialog");
      panel.hass = {...hass, states:{...hass.states}};
    });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await editor.evaluate(element => element === window.fixtureEditor), true);
    assert.equal(await editor.evaluate(element => element.open), true);
    for (const selector of [
      '[data-action="visibility-section"][data-hub="Home"][data-value="controls"]',
      '[data-action="visibility-entity"][data-hub="Home"][data-value="sensor.reading_0"]',
    ]) {
      await editor.locator(selector).evaluate(element => {
        element.checked = false;
        element.dispatchEvent(new Event("change", {bubbles:true}));
      });
    }
    await editor.locator('[data-action="editor-save"]').click();
    await page.waitForFunction(() => window.fixtureCalls.some(call => call.type === "wiser/panel/configure"));
    const saved = await page.evaluate(() => window.fixtureCalls.find(call => call.type === "wiser/panel/configure"));
    assert.equal(saved.panel_id, "registry-panel");
    assert.deepEqual(saved.configs.Home.hidden_sections, ["controls"]);
    assert.deepEqual(saved.configs.Home.hidden_entities, ["sensor.reading_0"]);
    assert.deepEqual(saved.configs.Workshop, {});
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
