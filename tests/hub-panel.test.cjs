const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function setup() {
  const elements = {};
  const context = {
    console,
    Intl,
    Date,
    window:{},
    requestAnimationFrame(callback) { callback(); return 1; },
    cancelAnimationFrame() {},
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    HTMLElement: class {
      attachShadow() {
        this.shadowRoot = {
          host:this,
          activeElement:null,
          innerHTML:"",
          addEventListener() {},
          querySelector() { return null; },
        };
      }
      dispatchEvent(event) { this.lastEvent = event; }
    },
    customElements:{
      get(name) { return elements[name]; },
      define(name, constructor) { elements[name] = constructor; },
    },
  };
  const languages = ["en-US", "en-GB", "fr", "de"];
  const translations = Object.fromEntries(languages.map(language => [
    language,
    JSON.parse(fs.readFileSync(
      path.join(__dirname, `../src/localize/languages/${language}.json`),
      "utf8",
    )),
  ]));
  const source = fs.readFileSync(path.join(__dirname, "../src/wiser-hub-panel.js"), "utf8")
    .replaceAll("__WISER_HUB_TRANSLATIONS__", JSON.stringify(translations));
  vm.runInNewContext(source, context);
  return {Panel:elements["wiser-hub-panel"], helpers:context.window.WiserHubPanelTest};
}

const state = (entity_id, value, attributes = {}) => ({
  entity_id,
  state:String(value),
  attributes,
  last_changed:"2026-10-01T08:00:00Z",
});

test("registers only the Wiser Hub panel custom element", () => {
  const {Panel} = setup();
  assert.equal(typeof Panel, "function");
  assert.equal(Panel.panelApiVersion, 1);
});

test("localizes panel labels from Home Assistant's language", () => {
  const {helpers} = setup();
  assert.equal(helpers.languageFor({locale:{language:"en-GB"}}), "en-GB");
  assert.equal(helpers.languageFor({language:"fr-FR"}), "fr");
  assert.equal(helpers.languageFor({language:"de-DE"}), "de");
  assert.equal(helpers.localize("panel.at_a_glance", {language:"fr"}), "Vue d’ensemble");
  assert.equal(helpers.localize("group.controls", {language:"de"}), "Hub-Steuerung");
  assert.equal(helpers.localize("panel.at_a_glance", {language:"es"}), "At a glance");
  assert.equal(helpers.localize("common.retry", {
    language:"fr",
    localize:key => key === "ui.common.retry" ? "Traduction native" : key,
  }), "Traduction native");
});

test("uses Home Assistant's native entity name and state formatters", () => {
  const {Panel, helpers} = setup();
  const entity = state("sensor.boiler", 12.5, {friendly_name:"Fallback boiler"});
  const hass = {
    formatEntityName:() => "Native boiler name",
    formatEntityState:stateObject => `Native ${stateObject.state}`,
  };
  assert.equal(
    helpers.entityName(entity, {entity_id:entity.entity_id}, hass),
    "Native boiler name",
  );
  const panel = new Panel();
  panel._hass = {...hass, states:{[entity.entity_id]:entity}};
  assert.equal(panel._formatState(entity), "Native 12.5");
  assert.equal(panel._formatHistoryValue(entity, 10.126), "Native 10.13");

  const icon = {dataset:{stateIcon:entity.entity_id}};
  const display = {dataset:{stateDisplay:entity.entity_id}};
  panel.shadowRoot.querySelectorAll = selector => (
    selector === "[data-state-icon]" ? [icon] : [display]
  );
  panel._hydrateNativeEntityElements();
  assert.equal(icon.stateObj, entity);
  assert.equal(display.stateObj, entity);
  assert.equal(display.hass, panel._hass);
});

test("groups dynamically discovered entity types", () => {
  const {helpers} = setup();
  const classify = (entity_id, attributes = {}, entry = {}) => helpers.groupFor(
    {entity_id, ...entry},
    state(entity_id, 1, attributes),
  );
  assert.equal(classify("climate.lounge"), "heating");
  assert.equal(classify("switch.away_mode"), "controls");
  assert.equal(classify("cover.hub_output"), "controls");
  assert.equal(classify("sensor.hub_power", {device_class:"power"}), "energy");
  assert.equal(classify("sensor.room_temperature", {device_class:"temperature"}), "environment");
  assert.equal(classify("sensor.hub_signal", {device_class:"signal_strength"}), "diagnostics");
  assert.equal(classify("select.heating_mode", {}, {entity_category:"config"}), "controls");
  assert.equal(classify("button.identify"), "actions");
});

test("builds bounded chart geometry for live recorder data", () => {
  const {helpers} = setup();
  const graph = helpers.chartPoints([{value:10}, {value:20}, {value:15}]);
  assert.equal(graph.min, 10);
  assert.equal(graph.max, 20);
  assert.match(graph.points, /^0\.0,81\.0 150\.0,5\.0 300\.0,43\.0$/);
  assert.equal(helpers.chartPoints([]).points, "");
  assert.equal(helpers.chartPoints([]).min, null);
  assert.equal(helpers.chartPoints([]).max, null);
});

test("keeps fixed hub capability values out of history charts", () => {
  const {helpers} = setup();
  const capacity = state("sensor.maximum_boiler_capacity", 30, {
    friendly_name:"Wiser HeatHub Maximum boiler capacity",
    device_class:"power",
  });
  const output = state("sensor.estimated_boiler_output", 12, {
    friendly_name:"Wiser HeatHub Estimated boiler output",
    device_class:"power",
  });
  assert.equal(helpers.chartable({entity_id:capacity.entity_id}, capacity), false);
  assert.equal(helpers.chartable({entity_id:output.entity_id}, output), true);
});

test("does not report an unpressed Home Assistant button as unavailable", () => {
  const {helpers} = setup();
  assert.equal(helpers.unavailable(state("button.boost_all", "unknown")), false);
  assert.equal(helpers.unavailable(state("sensor.offline", "unavailable")), true);
  assert.equal(helpers.unavailable(undefined), true);
});

test("discovers only enabled Wiser entities for the selected hub", async () => {
  const {Panel} = setup();
  const panel = new Panel();
  const requests = [];
  panel._hass = {
    states:{
      "sensor.temperature":state("sensor.temperature", 20, {device_class:"temperature"}),
      "sensor.disabled":state("sensor.disabled", 10),
      "sensor.other":state("sensor.other", 5),
    },
    callWS:async ({type}) => {
      requests.push(type);
      return ({
        "config/entity_registry/list":[
          {entity_id:"sensor.temperature", platform:"wiser", config_entry_id:"hub-a", device_id:"device-a"},
          {entity_id:"sensor.disabled", platform:"wiser", config_entry_id:"hub-a", device_id:"device-a", disabled_by:"integration"},
          {entity_id:"sensor.child", platform:"wiser", config_entry_id:"hub-a", device_id:"device-child"},
          {entity_id:"sensor.other", platform:"wiser", config_entry_id:"hub-b", device_id:"device-b"},
          {entity_id:"sensor.foreign", platform:"other", config_entry_id:"hub-a"},
        ],
        "config/device_registry/list":[
          {id:"device-a", config_entries:["hub-a"], manufacturer:"Drayton", model:"HubR"},
          {id:"device-child", config_entries:["hub-a"], via_device_id:"device-a", model:"Smart plug", disabled_by:"user"},
          {id:"room-a", config_entries:["hub-a"], via_device_id:"device-a", identifiers:[["wiser", "Home room 7"]], model:"Room"},
        ],
      })[type];
    },
  };
  panel._config = {hubs:["Home"], hub_ids:{Home:"hub-a"}};
  panel._hub = "Home";
  panel._loadHistory = () => {};
  await panel._discover();
  assert.deepEqual(requests.sort(), [
    "config/device_registry/list",
    "config/entity_registry/list",
  ]);
  assert.deepEqual(Array.from(panel._hubEntries(), entry => entry.entity_id), ["sensor.temperature"]);
  assert.equal(panel._hubEntries(true).length, 2);
  assert.equal(panel._hubDevices().length, 1);
  assert.equal(panel._integrationDevices().length, 3);
  assert.equal(panel._roomDevices().length, 1);
  const summary = panel._summary();
  assert.equal(summary.devices.length, 3);
  assert.equal(summary.disabledDevices.length, 1);
  assert.equal(summary.rooms.length, 1);
  assert.equal(summary.enabled.length, 1);
  assert.equal(summary.disabled.length, 1);
  assert.equal(summary.offline.length, 0);
});

test("ignores Home Assistant updates unrelated to the selected hub", () => {
  const {Panel} = setup();
  const panel = new Panel();
  const hubState = state("sensor.hub_temperature", 20, {device_class:"temperature"});
  const previous = {
    states:{
      [hubState.entity_id]:hubState,
      "sensor.unrelated":state("sensor.unrelated", 1),
    },
  };
  panel._hass = previous;
  panel._config = {hubs:["Home"], hub_ids:{Home:"hub-a"}};
  panel._hub = "Home";
  panel._entries = [
    {entity_id:hubState.entity_id, platform:"wiser", config_entry_id:"hub-a", device_id:"device-a"},
  ];
  panel._devices = [
    {id:"device-a", config_entries:["hub-a"], manufacturer:"Drayton", model:"HubR"},
  ];
  let renders = 0;
  panel._renderSoon = () => { renders += 1; };

  panel.hass = {
    ...previous,
    states:{...previous.states, "sensor.unrelated":state("sensor.unrelated", 2)},
  };

  assert.equal(renders, 0);
});

test("refreshes discovery when Home Assistant registries change", () => {
  const {Panel} = setup();
  const panel = new Panel();
  const entities = {};
  const devices = {};
  panel._hass = {states:{}, entities, devices};
  let forced;
  panel._discover = force => { forced = force; };
  panel._renderSoon = () => assert.fail("registry changes should rediscover before rendering");

  panel.hass = {states:{}, entities:{...entities}, devices};

  assert.equal(forced, true);
});

test("renders when a selected hub state changes", () => {
  const {Panel} = setup();
  const panel = new Panel();
  const hubState = state("sensor.hub_temperature", 20, {device_class:"temperature"});
  const previous = {states:{[hubState.entity_id]:hubState}};
  panel._hass = previous;
  panel._config = {hubs:["Home"], hub_ids:{Home:"hub-a"}};
  panel._hub = "Home";
  panel._entries = [
    {entity_id:hubState.entity_id, platform:"wiser", config_entry_id:"hub-a", device_id:"device-a"},
  ];
  panel._devices = [
    {id:"device-a", config_entries:["hub-a"], manufacturer:"Drayton", model:"HubR"},
  ];
  let renders = 0;
  panel._renderSoon = () => { renders += 1; };

  panel.hass = {
    ...previous,
    states:{...previous.states, [hubState.entity_id]:state(hubState.entity_id, 21, hubState.attributes)},
  };

  assert.equal(renders, 1);
});

test("switches hub tabs with standard keyboard navigation", () => {
  const {Panel} = setup();
  const panel = new Panel();
  panel._config = {hubs:["Home", "Workshop", "Office"]};
  panel._hub = "Home";
  panel._query = "temperature";
  let histories = 0;
  let renders = 0;
  panel._loadHistory = () => { histories += 1; };
  panel._renderSoon = () => { renders += 1; };
  let prevented = false;
  const tab = {dataset:{action:"hub", hub:"Home"}};

  panel._keydown({
    key:"ArrowLeft",
    target:{closest:() => tab},
    preventDefault:() => { prevented = true; },
  });

  assert.equal(panel._hub, "Office");
  assert.equal(panel._query, "");
  assert.equal(panel._pendingHubFocus, "Office");
  assert.equal(histories, 1);
  assert.equal(renders, 1);
  assert.equal(prevented, true);
});

test("shows switch changes immediately while Home Assistant confirms the service", async () => {
  const {Panel} = setup();
  const panel = new Panel();
  let release;
  let calls = 0;
  panel._hass = {
    states:{"switch.plug":state("switch.plug", "off")},
    callService:() => {
      calls += 1;
      return new Promise(resolve => { release = resolve; });
    },
  };
  panel._renderSoon = () => {};
  const target = {dataset:{action:"service", domain:"switch", service:"turn_on", entity:"switch.plug"}};
  const request = panel._click({target:{closest:() => target}});
  assert.equal(panel._displayState("switch.plug").state, "on");
  assert.equal(panel._busy.has("switch.plug"), true);
  assert.match(
    panel._control({entity_id:"switch.plug"}, panel._hass.states["switch.plug"]),
    /disabled aria-busy="true"/,
  );
  await panel._click({target:{closest:() => target}});
  assert.equal(calls, 1);
  release();
  await request;
  assert.equal(panel._busy.has("switch.plug"), false);
});

test("clears a stale error after a successful service action", async () => {
  const {Panel} = setup();
  const panel = new Panel();
  panel._error = "Previous failure";
  panel._hass = {callService:async () => {}};
  let renders = 0;
  panel._renderSoon = () => { renders += 1; };
  const target = {
    dataset:{action:"service", domain:"button", service:"press", entity:"button.identify"},
  };

  await panel._click({target:{closest:() => target}});

  assert.equal(panel._error, "");
  assert.equal(renders, 2);
});

test("clears a stale error after a successful value update", async () => {
  const {Panel} = setup();
  const panel = new Panel();
  panel._error = "Previous failure";
  panel._hass = {callService:async () => {}};
  panel._renderSoon = () => {};

  await panel._change({
    target:{dataset:{action:"select", entity:"select.mode"}, value:"Auto"},
  });

  assert.equal(panel._error, "");
});

test("adds accessible labels to search and history charts", () => {
  const {Panel} = setup();
  const panel = new Panel();
  const temperature = state("sensor.hub_temperature", 20, {
    device_class:"temperature",
    friendly_name:"Hub temperature",
  });
  panel._hass = {states:{[temperature.entity_id]:temperature}};
  panel._config = {hubs:["Home"], hub_ids:{Home:"hub-a"}};
  panel._hub = "Home";
  panel._entries = [
    {entity_id:temperature.entity_id, platform:"wiser", config_entry_id:"hub-a", device_id:"device-a"},
  ];
  panel._devices = [
    {id:"device-a", config_entries:["hub-a"], manufacturer:"Drayton", model:"HubR"},
  ];
  const charts = panel._charts();
  assert.match(charts, /role="img"/);
  assert.match(charts, /aria-label="24-hour history for Hub temperature"/);
  assert.ok(charts.indexOf("</summary>") < charts.indexOf('class="refresh"'));
  assert.match(charts, /class="refresh"[\s\S]*aria-label="Refresh charts"/);

  panel._visibleEntities = () => [];
  panel._summary = () => ({devices:[], disabledDevices:[], rooms:[], enabled:[], disabled:[], offline:[], batteries:[]});
  panel._groups = () => "";
  panel._charts = () => "";
  panel._render();
  assert.match(
    panel.shadowRoot.innerHTML,
    /id="search"[\s\S]*aria-label="Find a hub control or sensor…"/,
  );
});

test("restores scroll only after collapsed sections regain their state", () => {
  const {Panel} = setup();
  const panel = new Panel();
  const operations = [];
  let rendered = false;
  let scrollTop = 640;
  const previousGroup = {dataset:{group:"diagnostics"}};
  const nextGroup = {
    dataset:{group:"diagnostics"},
    _open:true,
    set open(value) { this._open = value; operations.push(`group:${value}`); },
    get open() { return this._open; },
  };
  const host = {
    get scrollTop() { return scrollTop; },
    set scrollTop(value) { scrollTop = value; operations.push(`scroll:${value}`); },
  };
  Object.defineProperty(panel.shadowRoot, "innerHTML", {
    get:() => "",
    set:() => { rendered = true; },
  });
  panel.shadowRoot.host = host;
  panel.shadowRoot.activeElement = null;
  panel.shadowRoot.querySelector = () => null;
  panel.shadowRoot.querySelectorAll = selector => {
    if (selector === "details.entity-group:not([open])") return rendered ? [] : [previousGroup];
    if (selector === "details.entity-group") return rendered ? [nextGroup] : [];
    return [];
  };
  panel._hass = {states:{}};
  panel._config = {hubs:[]};
  panel._visibleEntities = () => [];
  panel._summary = () => ({devices:[], disabledDevices:[], rooms:[], enabled:[], disabled:[], offline:[], batteries:[]});
  panel._hubDevice = () => null;
  panel._groups = () => "";
  panel._charts = () => "";
  panel._hydrateNativeEntityElements = () => {};

  panel._render();

  assert.deepEqual(operations, ["group:false", "scroll:640"]);
});
