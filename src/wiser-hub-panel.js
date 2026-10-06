/* Dynamic Wiser hub overview panel. */
(() => {
  const VERSION = "__WISER_HUB_PANEL_VERSION__";
  const TRANSLATIONS = __WISER_HUB_TRANSLATIONS__;
  const pluralFormatters = new Map();
  const relativeTimeFormatters = new Map();
  const numberFormatters = new Map();
  const GROUP_MIN_WIDTH = 400;
  const GROUP_GAP = 16;
  const GROUP_MAX_COLUMNS = 4;
  const PAGE_MAX_WIDTH = 2400;
  const PAGE_MAX_HORIZONTAL_PADDING = 80;
  const FLOW_HORIZONTAL_ICON_PATH = "M3 7.45V4.15H7.4V1.49L11.71 5.8L7.4 10.11V7.45H3ZM15.75 12.2H19.05V16.6H21.71L17.4 20.91L13.09 16.6H15.75V12.2Z";
  const FLOW_VERTICAL_ICON_PATH = "M5.45 2.2H8.75V6.6H11.41L7.1 10.91L2.79 6.6H5.45V2.2ZM12.2 18.25V14.95H16.6V12.29L20.91 16.6L16.6 20.91V18.25H12.2Z";
  const NATIVE_KEYS = {
    "common.close":"ui.card.cover.close_cover",
    "common.cancel":"ui.common.cancel",
    "common.details":"ui.dialogs.more_info_control.details",
    "common.loading":"ui.init.loading",
    "common.open":"ui.card.cover.open_cover",
    "common.refresh":"ui.common.refresh",
    "common.retry":"ui.panel.app.retry",
    "common.run":"ui.card.service.run",
    "common.save":"ui.common.save",
    "common.stop":"ui.card.cover.stop_cover",
    "common.turn_off":"ui.card.common.turn_off",
    "common.turn_on":"ui.card.common.turn_on",
    "group.energy":"panel.energy",
    "group.sensors":"ui.panel.config.devices.entities.sensor",
    "panel.device_one":"ui.panel.config.devices.type.device_heading",
    "panel.device_other":"ui.panel.config.devices.caption",
    "panel.download_diagnostics":"ui.panel.config.devices.download_diagnostics",
    "panel.entities":"ui.panel.config.devices.entities.entities",
    "panel.entity_visibility":"ui.panel.config.devices.entities.entities",
    "panel.unavailable":"state.default.unavailable",
  };

  function languageFor(hass) {
    const language = (
      hass?.locale?.language
      || hass?.language
      || (typeof document !== "undefined" ? document.documentElement?.lang : "")
      || "en-US"
    ).replace(/_/g, "-").toLowerCase();
    if (language === "en-gb") return "en-GB";
    if (language === "fr" || language.startsWith("fr-")) return "fr";
    if (language === "de" || language.startsWith("de-")) return "de";
    return "en-US";
  }

  function localize(key, hass, values = {}) {
    const language = languageFor(hass);
    const nativeKey = NATIVE_KEYS[key];
    const native = nativeKey ? hass?.localize?.(nativeKey) : "";
    const translated = native && native !== nativeKey
      ? native
      : TRANSLATIONS[language]?.[key] || TRANSLATIONS["en-US"]?.[key] || key;
    return translated.replace(/\{(\w+)\}/g, (token, name) => String(values[name] ?? token));
  }

  function pluralKey(prefix, count, hass) {
    const language = languageFor(hass);
    if (!pluralFormatters.has(language)) {
      pluralFormatters.set(language, new Intl.PluralRules(language));
    }
    const form = pluralFormatters.get(language).select(count) === "one" ? "one" : "other";
    return `${prefix}_${form}`;
  }
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;",
  })[character]);
  const unavailable = state => !state || state.state === "unavailable";
  const numeric = state => state && state.state !== "" && Number.isFinite(Number(state.state));
  function groupColumnCount(width) {
    const panelWidth = Number.isFinite(Number(width)) ? Number(width) : 0;
    const availableWidth = Math.max(
      0,
      Math.min(panelWidth, PAGE_MAX_WIDTH) - PAGE_MAX_HORIZONTAL_PADDING,
    );
    const fittingColumns = Math.floor((availableWidth + GROUP_GAP) / (GROUP_MIN_WIDTH + GROUP_GAP));
    return Math.max(1, Math.min(GROUP_MAX_COLUMNS, fittingColumns));
  }
  function entityName(state, entry, hass) {
    if (state && typeof hass?.formatEntityName === "function") {
      try {
        const formatted = hass.formatEntityName(state, {type:"entity"});
        if (typeof formatted === "string" && formatted.trim()) return formatted;
      } catch (_error) {
        // Fall back to the registry and state values below.
      }
    }
    return entry?.name
      || entry?.original_name
      || state?.attributes?.friendly_name
      || entry?.entity_id
      || "";
  }
  const deviceClass = state => state?.attributes?.device_class || "";
  const domainOf = entityId => entityId?.split(".", 1)[0] || "";
  const relativeTime = (value, hass) => {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return "";
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    const language = languageFor(hass);
    if (!relativeTimeFormatters.has(language)) {
      relativeTimeFormatters.set(language, new Intl.RelativeTimeFormat(language, {numeric:"auto"}));
    }
    const formatter = relativeTimeFormatters.get(language);
    if (seconds < 60) return formatter.format(0, "second");
    if (seconds < 3600) return formatter.format(-Math.floor(seconds / 60), "minute");
    if (seconds < 86400) return formatter.format(-Math.floor(seconds / 3600), "hour");
    return formatter.format(-Math.floor(seconds / 86400), "day");
  };

  const GROUPS = [
    ["controls", "group.controls", "mdi:tune-variant"],
    ["actions", "group.actions", "mdi:gesture-tap-button"],
    ["heating", "group.heating", "mdi:radiator"],
    ["environment", "group.environment", "mdi:home-thermometer-outline"],
    ["energy", "group.energy", "mdi:flash"],
    ["safety", "group.safety", "mdi:shield-check-outline"],
    ["sensors", "group.sensors", "mdi:gauge"],
    ["diagnostics", "group.diagnostics", "mdi:stethoscope"],
    ["system", "group.system", "mdi:hub-outline"],
  ];
  const GROUP_KEYS = GROUPS.map(([key]) => key);
  const GROUP_KEY_SET = new Set(GROUP_KEYS);
  const GROUP_META = new Map(GROUPS.map(([key, titleKey, icon]) => [key, {titleKey, icon}]));
  function orderedGroupKeys(order) {
    const configured = Array.isArray(order)
      ? order.filter((key, index) => GROUP_KEY_SET.has(key) && order.indexOf(key) === index)
      : [];
    return [...configured, ...GROUP_KEYS.filter(key => !configured.includes(key))];
  }
  const sectionFlow = value => value === "vertical" ? "vertical" : "horizontal";
  function verticalGroupColumns(items, requestedColumns) {
    const columnCount = Math.max(1, Math.min(Number(requestedColumns) || 1, items.length || 1));
    const columns = Array.from({length:columnCount}, () => []);
    let offset = 0;
    let remainingWeight = items.reduce((total, item) => total + item.weight, 0);
    for (let column = 0; column < columnCount && offset < items.length; column += 1) {
      const columnsLeft = columnCount - column;
      const targetWeight = remainingWeight / columnsLeft;
      let columnWeight = 0;
      while (offset < items.length - (columnsLeft - 1)) {
        const next = items[offset];
        const currentDifference = Math.abs(targetWeight - columnWeight);
        const nextDifference = Math.abs(targetWeight - (columnWeight + next.weight));
        if (columns[column].length && currentDifference <= nextDifference) break;
        columns[column].push(next);
        columnWeight += next.weight;
        offset += 1;
      }
      if (!columns[column].length) {
        columns[column].push(items[offset]);
        columnWeight += items[offset].weight;
        offset += 1;
      }
      remainingWeight -= columnWeight;
    }
    return columns;
  }
  function horizontalGroupColumns(items, requestedColumns) {
    const columnCount = Math.max(1, Math.min(Number(requestedColumns) || 1, items.length || 1));
    const columns = Array.from({length:columnCount}, () => []);
    const columnWeights = Array(columnCount).fill(0);
    for (const item of items) {
      const column = columnWeights.indexOf(Math.min(...columnWeights));
      columns[column].push(item);
      columnWeights[column] += item.weight;
    }
    return columns;
  }
  const ENERGY_CLASSES = new Set(["power", "energy", "current", "voltage", "power_factor", "gas", "water"]);
  const ENVIRONMENT_CLASSES = new Set(["temperature", "humidity", "pressure", "illuminance", "moisture", "volatile_organic_compounds"]);
  const DIAGNOSTIC_CLASSES = new Set(["battery", "signal_strength", "connectivity", "timestamp", "duration"]);
  const CHART_CLASSES = new Set([
    "power", "energy", "temperature", "humidity", "battery",
    "signal_strength", "pressure", "current", "voltage",
  ]);
  const STATIC_READING = /(?:^|[ ._-])(maximum|minimum|max|min|capacity|limit|rating|rated)(?:$|[ ._-])/i;

  function chartable(entry, state) {
    return numeric(state)
      && CHART_CLASSES.has(deviceClass(state))
      && !STATIC_READING.test(`${entry.entity_id} ${entityName(state, entry)}`);
  }

  function groupFor(entry, state) {
    const domain = domainOf(entry.entity_id);
    const kind = deviceClass(state);
    if (domain === "update") return "system";
    if (entry.entity_category === "diagnostic" || DIAGNOSTIC_CLASSES.has(kind)) return "diagnostics";
    if (domain === "climate" || entry.entity_id.includes("hot_water")) return "heating";
    if (entry.entity_category === "config") return "controls";
    if (["switch", "light", "cover"].includes(domain)) return "controls";
    if (ENERGY_CLASSES.has(kind)) return "energy";
    if (ENVIRONMENT_CLASSES.has(kind)) return "environment";
    if (domain === "binary_sensor") return "safety";
    if (domain === "button") return "actions";
    if (["select", "number", "input_number"].includes(domain)) return "controls";
    if (domain === "sensor") return "sensors";
    return "system";
  }

  function chartPoints(values, width = 300, height = 86) {
    if (!values.length) return {points:"", min:null, max:null};
    const numbers = values.map(item => item.value);
    const min = Math.min(...numbers), max = Math.max(...numbers);
    const span = max - min || 1;
    const points = values.map((item, index) => {
      const x = values.length === 1 ? width : index / (values.length - 1) * width;
      const y = height - 5 - (item.value - min) / span * (height - 10);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return {points, min, max};
  }

  class WiserHubPanel extends HTMLElement {
    static panelApiVersion = 1;

    constructor() {
      super();
      this.attachShadow({mode:"open"});
      this.shadowRoot.innerHTML = `<div id="panel-content"></div>
        <ha-dialog id="config-dialog" width="medium"></ha-dialog>`;
      this._entries = [];
      this._devices = [];
      this._history = new Map();
      this._optimistic = new Map();
      this._busy = new Set();
      this._loading = true;
      this._historyLoading = false;
      this._diagnosticsBusy = false;
      this._attentionOpen = false;
      this._disabledDevicesOpen = false;
      this._disabledEntitiesOpen = false;
      this._editorOpen = false;
      this._editorDrafts = null;
      this._editorHub = null;
      this._editorError = "";
      this._savingSettings = false;
      this._draggedSection = null;
      this._sectionFlowControlPromise = null;
      this._sectionStates = new Map();
      this._error = "";
      this._query = "";
      this._renderFrame = 0;
      this._groupColumnCount = 1;
      this._resizeObserver = null;
      this._configFingerprint = "";
      this._registryLoaded = false;
      this.shadowRoot.addEventListener("click", event => this._click(event));
      this.shadowRoot.addEventListener("keydown", event => this._keydown(event));
      this.shadowRoot.addEventListener("change", event => this._change(event));
      this.shadowRoot.addEventListener("dragstart", event => this._sectionDragStart(event));
      this.shadowRoot.addEventListener("dragover", event => this._sectionDragOver(event));
      this.shadowRoot.addEventListener("drop", event => this._sectionDrop(event));
      this.shadowRoot.addEventListener("dragend", () => this._clearSectionDrag());
      this.shadowRoot.addEventListener("input", event => {
        if (event.target?.id === "search") {
          this._query = event.target.value;
          this._renderSoon();
        }
      });
      const configDialog = this.shadowRoot.querySelector?.("#config-dialog");
      configDialog?.addEventListener("closed", () => this._closeEditor());
      configDialog?.addEventListener("close-dialog", () => this._closeEditor());
      this.shadowRoot.addEventListener("toggle", event => this._sectionToggled(event), true);
    }

    set panel(value) {
      const config = value?.config || {};
      const fingerprint = JSON.stringify(config);
      const changed = fingerprint !== this._configFingerprint;
      this._config = config;
      this._configFingerprint = fingerprint;
      const hubs = Array.isArray(config.hubs) ? config.hubs : [];
      if (!hubs.includes(this._hub)) this._hub = hubs[0];
      if (changed) this._registryLoaded = false;
      if (!this._registryLoaded) this._discover();
    }

    set hass(value) {
      const firstHass = !this._hass;
      const updateAffectsPanel = this._hassUpdateAffectsPanel(this._hass, value);
      const connectionChanged = this._hass?.connection && this._hass.connection !== value?.connection;
      const registryChanged = Boolean(this._hass && (
        this._hass.entities !== value?.entities || this._hass.devices !== value?.devices
      ));
      this._hass = value;
      let optimisticChanged = false;
      for (const [entityId, pending] of this._optimistic) {
        if (value?.states?.[entityId]?.state === pending.state || Date.now() - pending.at > 5000) {
          this._optimistic.delete(entityId);
          optimisticChanged = true;
        }
      }
      if (connectionChanged || registryChanged) {
        this._registryLoaded = false;
        this._discover(true);
      } else if (firstHass && !this._registryLoaded && this._config) this._discover();
      else if (updateAffectsPanel || optimisticChanged) this._renderSoon();
    }

    connectedCallback() {
      if (typeof ResizeObserver === "function") {
        this._resizeObserver ||= new ResizeObserver(entries => {
          const width = entries[0]?.contentRect?.width || this.clientWidth;
          const columnCount = groupColumnCount(width);
          if (columnCount === this._groupColumnCount) return;
          this._groupColumnCount = columnCount;
          this._renderSoon();
        });
        this._resizeObserver.observe(this);
      }
      this._renderSoon();
    }
    disconnectedCallback() {
      if (this._renderFrame) cancelAnimationFrame(this._renderFrame);
      this._renderFrame = 0;
      this._resizeObserver?.disconnect();
      this._captureSectionState();
    }

    _renderSoon() {
      if (this._renderFrame) return;
      this._renderFrame = requestAnimationFrame(() => {
        this._renderFrame = 0;
        this._render();
      });
    }

    _hassUpdateAffectsPanel(previous, next) {
      if (!previous || !next) return true;
      if (
        previous.language !== next.language
        || previous.locale !== next.locale
        || previous.localize !== next.localize
        || previous.formatEntityName !== next.formatEntityName
        || previous.formatEntityState !== next.formatEntityState
        || previous.entities !== next.entities
        || previous.devices !== next.devices
        || previous.areas !== next.areas
      ) return true;
      return this._attentionEntries().some(entry => (
        previous.states?.[entry.entity_id] !== next.states?.[entry.entity_id]
      ));
    }

    async _discover(force = false) {
      if (!this._hass || !this._config || this._discovering && !force) return;
      const generation = (this._discoveryGeneration || 0) + 1;
      this._discoveryGeneration = generation;
      this._discovering = true;
      this._loading = !this._entries.length;
      this._error = "";
      this._renderSoon();
      try {
        const [entries, devices] = await Promise.all([
          this._hass.callWS({type:"config/entity_registry/list"}),
          this._hass.callWS({type:"config/device_registry/list"}),
        ]);
        if (generation !== this._discoveryGeneration) return;
        this._entries = entries.filter(entry => entry.platform === "wiser");
        this._devices = devices;
        this._registryLoaded = true;
        this._loading = false;
        this._loadHistory();
      } catch (error) {
        if (generation !== this._discoveryGeneration) return;
        this._loading = false;
        this._error = this._t("panel.discovery_error", {error:error.message || error});
      } finally {
        if (generation === this._discoveryGeneration) this._discovering = false;
        this._renderSoon();
      }
    }

    _hubId(hub = this._hub) { return this._config?.hub_ids?.[hub]; }
    _integrationEntries(includeDisabled = false, hub = this._hub) {
      const hubId = this._hubId(hub);
      return this._entries.filter(entry => (!hubId || entry.config_entry_id === hubId)
        && (includeDisabled || !entry.disabled_by));
    }
    _hubEntries(includeDisabled = false, hub = this._hub) {
      const deviceId = this._hubDevice(hub)?.id;
      return this._integrationEntries(includeDisabled, hub)
        .filter(entry => deviceId && entry.device_id === deviceId);
    }
    _hubSettings(hub = this._hub) {
      return this._config?.card_configs?.[hub] || {};
    }
    _hiddenSections() {
      return new Set(Array.isArray(this._hubSettings().hidden_sections)
        ? this._hubSettings().hidden_sections
        : []);
    }
    _hiddenEntities() {
      return new Set(Array.isArray(this._hubSettings().hidden_entities)
        ? this._hubSettings().hidden_entities
        : []);
    }
    _configurableEntities(hub = this._hub) {
      return this._hubEntries(false, hub)
        .map(entry => ({entry, state:this._hass?.states?.[entry.entity_id]}))
        .filter(({state}) => state)
        .sort((left, right) => entityName(left.state, left.entry, this._hass)
          .localeCompare(entityName(right.state, right.entry, this._hass), languageFor(this._hass)));
    }
    _attentionEntries() {
      const disabledDeviceIds = new Set(
        this._integrationDevices().filter(device => device.disabled_by).map(device => device.id),
      );
      return this._integrationEntries()
        .filter(entry => !entry.device_id || !disabledDeviceIds.has(entry.device_id));
    }
    _visibleEntities() {
      const language = languageFor(this._hass);
      const query = this._query.trim().toLocaleLowerCase(language);
      const hiddenEntities = this._hiddenEntities();
      return this._hubEntries()
        .map(entry => ({entry, state:this._displayState(entry.entity_id)}))
        .filter(item => item.state)
        .filter(({entry}) => !hiddenEntities.has(entry.entity_id))
        .filter(({entry, state}) => {
          const searchable = `${entityName(state, entry, this._hass)} ${entry.entity_id} ${state.state}`;
          return !query || searchable.toLocaleLowerCase(language).includes(query);
        });
    }
    _displayState(entityId) {
      const state = this._hass?.states?.[entityId];
      const pending = this._optimistic.get(entityId);
      return pending && state ? {...state, state:pending.state, last_changed:new Date(pending.at).toISOString()} : state;
    }
    _showOptimistic(entityId, value) {
      this._optimistic.set(entityId, {state:String(value), at:Date.now()});
      this._renderSoon();
    }
    _sectionStateKey(hub) {
      const panel = this._config?.panel_id || "default";
      return `wiser-hub-panel:${encodeURIComponent(panel)}:${encodeURIComponent(hub)}:sections:v1`;
    }
    _sectionState(hub = this._hub) {
      if (this._sectionStates.has(hub)) return this._sectionStates.get(hub);
      let saved;
      try {
        saved = JSON.parse(window.localStorage?.getItem(this._sectionStateKey(hub)) || "null");
      } catch (_error) {
        saved = null;
      }
      const state = {
        closedGroups:new Set(Array.isArray(saved?.closed_groups)
          ? saved.closed_groups.filter(key => GROUP_KEY_SET.has(key))
          : []),
        chartsOpen:saved?.charts_open !== false,
      };
      this._sectionStates.set(hub, state);
      return state;
    }
    _persistSectionState(hub = this._hub) {
      const state = this._sectionStates.get(hub);
      if (!hub || !state) return;
      try {
        window.localStorage?.setItem(this._sectionStateKey(hub), JSON.stringify({
          closed_groups:GROUP_KEYS.filter(key => state.closedGroups.has(key)),
          charts_open:state.chartsOpen,
        }));
      } catch (_error) {
        // Storage can be disabled; the in-memory state still supports hub switching.
      }
    }
    _captureSectionState(hub) {
      const content = this.shadowRoot.querySelector?.("#hub-panel-content");
      const renderedHub = content?.dataset?.hub;
      if (!content || !renderedHub || hub && renderedHub !== hub) return;
      const state = this._sectionState(renderedHub);
      let changed = false;
      for (const group of content.querySelectorAll?.("details.entity-group") || []) {
        const wasClosed = state.closedGroups.has(group.dataset.group);
        if (group.open) state.closedGroups.delete(group.dataset.group);
        else state.closedGroups.add(group.dataset.group);
        if (wasClosed === group.open) changed = true;
      }
      const charts = content.querySelector?.("details.charts-section");
      if (charts && state.chartsOpen !== charts.open) {
        state.chartsOpen = charts.open;
        changed = true;
      }
      if (changed) this._persistSectionState(renderedHub);
    }
    _sectionToggled(event) {
      const details = event.target;
      if (!details?.matches?.("details.entity-group, details.charts-section")) return;
      const hub = details.closest?.("#hub-panel-content")?.dataset?.hub;
      if (!hub) return;
      const state = this._sectionState(hub);
      if (details.classList.contains("charts-section")) state.chartsOpen = details.open;
      else if (details.open) state.closedGroups.delete(details.dataset.group);
      else state.closedGroups.add(details.dataset.group);
      this._persistSectionState(hub);
    }
    _selectHub(hub, focus = false) {
      if (!this._config?.hubs?.includes(hub)) return;
      if (focus) this._pendingHubFocus = hub;
      if (this._hub === hub) {
        if (focus) this._renderSoon();
        return;
      }
      this._captureSectionState(this._hub);
      this._hub = hub;
      this._query = "";
      this._closeEditor();
      this._attentionOpen = false;
      this._disabledDevicesOpen = false;
      this._disabledEntitiesOpen = false;
      this._loadHistory();
      this._renderSoon();
    }
    _keydown(event) {
      const tab = event.target.closest?.('[role="tab"][data-action]');
      if (!tab) return;
      const hubs = this._config?.hubs || [];
      const index = hubs.indexOf(tab.dataset.hub);
      if (index < 0) return;
      let next;
      if (event.key === "ArrowRight") next = (index + 1) % hubs.length;
      else if (event.key === "ArrowLeft") next = (index + hubs.length - 1) % hubs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = hubs.length - 1;
      else return;
      event.preventDefault();
      if (tab.dataset.action === "editor-hub") {
        this._selectEditorHub(hubs[next], true);
      } else if (tab.dataset.action === "hub") {
        this._selectHub(hubs[next], true);
      }
    }
    _clearError() {
      this._error = "";
    }
    async _downloadDiagnostics() {
      const entryId = this._hubId();
      if (!entryId || this._diagnosticsBusy) return;
      this._diagnosticsBusy = true;
      this._renderSoon();
      try {
        const download = await this._hass.callWS({
          type:"auth/sign_path",
          path:`/api/diagnostics/config_entry/${encodeURIComponent(entryId)}`,
        });
        const link = document.createElement("a");
        link.href = download.path;
        link.download = "";
        link.rel = "noopener";
        link.click();
        link.remove?.();
        this._clearError();
      } catch (error) {
        this._error = this._t("panel.diagnostics_error", {error:error.message || error});
      } finally {
        this._diagnosticsBusy = false;
        this._renderSoon();
      }
    }
    _integrationDevices(hub = this._hub) {
      const hubId = this._hubId(hub);
      return this._devices.filter(device => !hubId || device.config_entries?.includes(hubId));
    }
    _hubDevice(hub = this._hub, devices = this._integrationDevices(hub)) {
      return devices.find(device => (
        !device.via_device_id
        && /wiser|drayton|schneider/i.test(`${device.manufacturer || ""} ${device.model || ""}`)
      ))
        || devices.find(device => !device.via_device_id);
    }
    _hubDevices() {
      const hub = this._hubDevice();
      return hub ? [hub] : [];
    }
    _roomDevices(hub = this._hub, devices = this._integrationDevices(hub)) {
      const prefix = `${hub} room `;
      return devices.filter(device => device.identifiers?.some(identifier => {
        if (!Array.isArray(identifier) || identifier[0] !== "wiser") return false;
        const value = identifier[1];
        return typeof value === "string"
          && value.startsWith(prefix)
          && /^\d+$/.test(value.slice(prefix.length));
      }));
    }

    _chartEntities() {
      const hiddenEntities = this._hiddenEntities();
      return this._hubEntries()
        .map(entry => ({entry, state:this._hass?.states?.[entry.entity_id]}))
        .filter(({entry}) => !hiddenEntities.has(entry.entity_id))
        .filter(({entry, state}) => chartable(entry, state))
        .sort((left, right) => {
          const order = ["power", "energy", "temperature", "humidity", "battery", "signal_strength", "pressure", "current", "voltage"];
          return order.indexOf(deviceClass(left.state)) - order.indexOf(deviceClass(right.state));
        })
        .slice(0, 6);
    }

    async _loadHistory() {
      const candidates = this._chartEntities();
      const generation = (this._historyGeneration || 0) + 1;
      this._historyGeneration = generation;
      this._history = new Map();
      if (!candidates.length || !this._hass?.callApi) { this._renderSoon(); return; }
      this._historyLoading = true;
      this._renderSoon();
      const start = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      const ids = candidates.map(({entry}) => entry.entity_id).join(",");
      const path = `history/period/${encodeURIComponent(start)}?filter_entity_id=${encodeURIComponent(ids)}&minimal_response&no_attributes`;
      try {
        const result = await this._hass.callApi("GET", path);
        if (generation !== this._historyGeneration) return;
        for (const series of Array.isArray(result) ? result : []) {
          const id = series[0]?.entity_id;
          const values = series.map(item => ({
            value:Number(item.state),
            time:new Date(item.last_changed || item.last_updated).getTime(),
          })).filter(item => Number.isFinite(item.value) && Number.isFinite(item.time));
          if (id && values.length) this._history.set(id, values);
        }
      } catch (_error) {
        // History is optional; live entities remain fully usable.
      } finally {
        if (generation === this._historyGeneration) this._historyLoading = false;
        this._renderSoon();
      }
    }

    _formatState(state) {
      if (!state) return this._t("common.not_loaded");
      try { return this._hass.formatEntityState?.(state) || state.state; }
      catch (_error) { return state.state; }
    }

    _formatHistoryValue(state, value) {
      if (!Number.isFinite(value)) return "";
      const historicalState = {...state, state:String(Number(value.toFixed(2)))};
      try {
        const formatted = this._hass.formatEntityState?.(historicalState);
        if (formatted) return formatted;
      } catch (_error) {
        // Fall back to locale-aware numeric formatting below.
      }
      const language = languageFor(this._hass);
      if (!numberFormatters.has(language)) {
        numberFormatters.set(language, new Intl.NumberFormat(language, {maximumFractionDigits:2}));
      }
      const number = numberFormatters.get(language).format(value);
      return `${number}${state.attributes.unit_of_measurement || ""}`;
    }

    _t(key, values = {}) {
      return localize(key, this._hass, values);
    }

    _plural(prefix, count) {
      return this._t(pluralKey(prefix, count, this._hass), {count});
    }

    _summary() {
      const devices = this._integrationDevices();
      const disabledDevices = devices.filter(device => device.disabled_by);
      const rooms = this._roomDevices(this._hub, devices);
      const hubDeviceId = this._hubDevice(this._hub, devices)?.id;
      const allEntries = this._integrationEntries(true);
      const enabledEntries = allEntries.filter(entry => !entry.disabled_by);
      const enabled = enabledEntries.filter(entry => hubDeviceId && entry.device_id === hubDeviceId);
      const disabled = allEntries.filter(entry => (
        entry.disabled_by && hubDeviceId && entry.device_id === hubDeviceId
      ));
      const disabledDeviceIds = new Set(disabledDevices.map(device => device.id));
      const entities = enabledEntries
        .filter(entry => !entry.device_id || !disabledDeviceIds.has(entry.device_id))
        .map(entry => ({entry, state:this._hass?.states?.[entry.entity_id]}))
        .filter(({state}) => state);
      const offline = entities.filter(({state}) => unavailable(state));
      const batteries = entities.filter(({state}) => (
        deviceClass(state) === "battery"
        && numeric(state)
        && Number(state.state) < 20
      ));
      return {devices, disabledDevices, rooms, enabled, disabled, offline, batteries};
    }

    _openEditor() {
      if (!this._hass?.user?.is_admin || !this._config?.panel_id || !this._config?.hubs?.length) return;
      const dialog = this.shadowRoot.querySelector?.("#config-dialog");
      if (dialog?.open) return;
      this._editorDrafts = Object.fromEntries((this._config.hubs || []).map(hub => {
        const settings = this._hubSettings(hub);
        return [hub, {
          hidden_sections:[...(Array.isArray(settings.hidden_sections) ? settings.hidden_sections : [])],
          hidden_entities:[...(Array.isArray(settings.hidden_entities) ? settings.hidden_entities : [])],
          show_entity_ids:Boolean(settings.show_entity_ids),
          section_order:orderedGroupKeys(settings.section_order),
          section_flow:sectionFlow(settings.section_flow),
        }];
      }));
      this._editorHub = this._config.hubs?.includes(this._hub) ? this._hub : this._config.hubs?.[0];
      this._editorError = "";
      this._editorOpen = true;
      this._renderEditor();
      if (!customElements.get("ha-button-toggle-group")) {
        this._ensureSectionFlowControl().then(loaded => {
          if (loaded && this._editorOpen) this._renderEditor();
        });
      }
    }

    _ensureSectionFlowControl() {
      if (customElements.get("ha-button-toggle-group")) return Promise.resolve(true);
      if (this._sectionFlowControlPromise) return this._sectionFlowControlPromise;
      this._sectionFlowControlPromise = (async () => {
        await customElements.whenDefined("partial-panel-resolver");
        const resolver = document.createElement("partial-panel-resolver");
        const routeKey = "wiser-calendar-loader";
        const panels = [{url_path:routeKey, component_name:"calendar"}];
        const routes = resolver.getRoutes?.(panels);
        let route = routes?.routes?.[routeKey];
        let loadRoute = typeof route?.load === "function" ? route.load.bind(route) : null;
        if (typeof loadRoute !== "function") {
          resolver.hass = {panels};
          resolver._updateRoutes?.();
          route = resolver.routerOptions?.routes?.[routeKey];
          loadRoute = typeof route?.load === "function" ? route.load.bind(route) : null;
        }
        if (typeof loadRoute !== "function") throw new Error("Home Assistant calendar route is unavailable");
        await loadRoute();
        await customElements.whenDefined("ha-button-toggle-group");
        return true;
      })().catch(() => {
        this._sectionFlowControlPromise = null;
        return false;
      });
      return this._sectionFlowControlPromise;
    }

    _closeEditor() {
      if (!this._editorOpen) return;
      this._editorOpen = false;
      this._editorDrafts = null;
      this._editorHub = null;
      this._editorError = "";
      const dialog = this.shadowRoot.querySelector?.("#config-dialog");
      if (dialog) dialog.open = false;
    }

    async _saveEditor() {
      if (!this._editorDrafts || this._savingSettings) return;
      this._savingSettings = true;
      this._editorError = "";
      this._updateEditorState();
      try {
        const configs = Object.fromEntries((this._config.hubs || []).map(hub => {
          const draft = this._editorDrafts[hub];
          const settings = {...this._hubSettings(hub)};
          const hiddenSections = [...new Set(draft.hidden_sections)].sort();
          const hiddenEntities = [...new Set(draft.hidden_entities)].sort();
          if (hiddenSections.length) settings.hidden_sections = hiddenSections;
          else delete settings.hidden_sections;
          if (hiddenEntities.length) settings.hidden_entities = hiddenEntities;
          else delete settings.hidden_entities;
          if (draft.show_entity_ids) settings.show_entity_ids = true;
          else delete settings.show_entity_ids;
          const sectionOrder = orderedGroupKeys(draft.section_order);
          if (sectionOrder.some((key, index) => key !== GROUP_KEYS[index])) {
            settings.section_order = sectionOrder;
          } else delete settings.section_order;
          if (sectionFlow(draft.section_flow) === "vertical") settings.section_flow = "vertical";
          else delete settings.section_flow;
          return [hub, settings];
        }));
        await this._hass.callWS({
          type:"wiser/panel/configure",
          panel_id:this._config.panel_id,
          configs,
        });
        this._config = {
          ...this._config,
          card_configs:{...this._config.card_configs, ...configs},
        };
        this._configFingerprint = JSON.stringify(this._config);
        this._closeEditor();
        this._loadHistory();
      } catch (error) {
        this._editorError = this._t("panel.settings_save_error", {error:error.message || error});
      } finally {
        this._savingSettings = false;
        this._updateEditorState();
      }
    }

    _editorHubMarkup(hub, index) {
      const draft = this._editorDrafts?.[hub];
      if (!draft) return "";
      const hiddenSections = new Set(draft.hidden_sections);
      const hiddenEntities = new Set(draft.hidden_entities);
      const configurableEntities = this._configurableEntities(hub);
      const groupedEntities = new Map(GROUPS.map(([key]) => [key, []]));
      for (const item of configurableEntities) {
        groupedEntities.get(groupFor(item.entry, item.state)).push(item);
      }
      const orderedSections = orderedGroupKeys(draft.section_order)
        .map(key => ({key, ...GROUP_META.get(key), items:groupedEntities.get(key)}))
        .filter(({items}) => items.length);
      const entitySections = orderedSections.map(({key, titleKey, icon, items}) => {
        const rows = items.map(({entry, state}) => `<ha-checkbox
            class="visibility-row entity-visibility-row"
            data-action="visibility-entity"
            data-hub="${esc(hub)}"
            data-value="${esc(entry.entity_id)}"
            ${hiddenEntities.has(entry.entity_id) ? "" : "checked"}
          >
            <span>
              ${esc(entityName(state, entry, this._hass))}
              <small>${esc(entry.entity_id)}</small>
            </span>
          </ha-checkbox>`).join("");
        return `<ha-expansion-panel
          class="entity-visibility-section"
          data-group="${esc(key)}"
          data-hub="${esc(hub)}"
          outlined
        >
          <ha-icon
            class="entity-section-drag-handle"
            slot="leading-icon"
            icon="mdi:drag-vertical"
            draggable="true"
          ></ha-icon>
          <div class="entity-section-header" slot="header" role="heading" aria-level="3">
            <ha-icon class="entity-section-icon" icon="${icon}"></ha-icon>
            <span>${this._t(titleKey)}</span>
            <small>${items.length} ${this._t(pluralKey("panel.entity", items.length, this._hass))}</small>
            <ha-switch
              data-action="visibility-section"
              data-hub="${esc(hub)}"
              data-value="${esc(key)}"
              aria-label="${esc(this._t(titleKey))}"
              ${hiddenSections.has(key) ? "" : "checked"}
            ></ha-switch>
          </div>
          <div class="visibility-list entity-visibility-list">${rows}</div>
        </ha-expansion-panel>`;
      }).join("");
      return `<section
          id="editor-hub-panel-${index}"
          class="hub-editor"
          data-hub="${esc(hub)}"
          role="tabpanel"
          aria-labelledby="editor-hub-tab-${index}"
          ${hub === this._editorHub ? "" : "hidden"}
        >
          <h2>${esc(hub)}</h2>
          <p>${this._t("panel.settings_description", {hub})}</p>
          <div class="standalone-section-toggle entity-id-toggle">
            <ha-icon icon="mdi:identifier"></ha-icon>
            <span>${this._t("panel.show_entity_ids")}</span>
            <ha-switch
              data-action="show-entity-ids"
              data-hub="${esc(hub)}"
              aria-label="${esc(this._t("panel.show_entity_ids"))}"
              ${draft.show_entity_ids ? "checked" : ""}
            ></ha-switch>
          </div>
          <div class="standalone-section-toggle section-flow-setting">
            <ha-icon icon="mdi:view-dashboard-outline"></ha-icon>
            <span>${this._t("panel.section_flow")}</span>
            <ha-button-toggle-group
              class="section-flow-options"
              data-hub="${esc(hub)}"
              size="s"
              no-wrap
              aria-label="${esc(this._t("panel.section_flow"))}"
            ></ha-button-toggle-group>
          </div>
          <section>
            <h3>${this._t("panel.section_visibility")}</h3>
            <div class="standalone-section-toggle">
              <ha-icon icon="mdi:chart-line"></ha-icon>
              <span>${this._t("panel.history_section")}</span>
              <ha-switch
                data-action="visibility-section"
                data-hub="${esc(hub)}"
                data-value="history"
                aria-label="${esc(this._t("panel.history_section"))}"
                ${hiddenSections.has("history") ? "" : "checked"}
              ></ha-switch>
            </div>
          </section>
          ${entitySections ? `<section>
            <h3>${this._t("panel.entity_visibility")}</h3>
            <div class="entity-visibility-sections" data-hub="${esc(hub)}">${entitySections}</div>
          </section>` : ""}
        </section>`;
    }

    _editorMarkup() {
      if (!this._editorDrafts) return "";
      const hubs = this._config.hubs || [];
      const hubTabs = hubs.length > 1 ? `<nav class="editor-hub-tabs" role="tablist" aria-label="${esc(this._t("panel.wiser_hubs"))}">
        ${hubs.map((hub, index) => `<button
          type="button"
          id="editor-hub-tab-${index}"
          class="editor-hub-tab"
          role="tab"
          aria-controls="editor-hub-panel-${index}"
          aria-selected="${hub === this._editorHub}"
          tabindex="${hub === this._editorHub ? 0 : -1}"
          data-action="editor-hub"
          data-hub="${esc(hub)}"
        >${esc(hub)}</button>`).join("")}
      </nav>` : "";
      const hubEditors = hubs.map((hub, index) => this._editorHubMarkup(hub, index)).join("");
      return `<div class="config-editor">
          ${hubTabs}
          ${hubEditors}
          <p class="editor-error" role="alert">${esc(this._editorError)}</p>
        </div>
        <div class="dialog-actions" id="editor-actions" slot="footer">
          <span class="editor-version">Wiser Hub Panel · ${esc(VERSION)}</span>
          <ha-button appearance="plain" data-action="editor-cancel" ${this._savingSettings ? "disabled" : ""}>
            ${this._t("common.cancel")}
          </ha-button>
          <ha-button data-action="editor-save" ${this._savingSettings ? "disabled" : ""}>
            ${this._t("common.save")}
          </ha-button>
        </div>`;
    }

    _renderEditor() {
      const dialog = this.shadowRoot.querySelector?.("#config-dialog");
      if (!dialog || !this._editorOpen || !this._editorDrafts) return;
      dialog.innerHTML = this._editorMarkup();
      dialog.setAttribute("aria-label", this._t("panel.settings"));
      dialog.setAttribute("header-title", this._t("panel.settings"));
      dialog.heading = this._t("panel.settings");
      for (const checkbox of dialog.querySelectorAll?.("ha-checkbox[data-action]") || []) {
        checkbox.checked = checkbox.hasAttribute("checked");
      }
      for (const toggle of dialog.querySelectorAll?.("ha-switch[data-action]") || []) {
        toggle.checked = toggle.hasAttribute("checked");
        toggle.addEventListener("click", event => event.stopPropagation());
      }
      for (const toggle of dialog.querySelectorAll?.("ha-button-toggle-group.section-flow-options") || []) {
        const draft = this._editorDrafts?.[toggle.dataset.hub];
        toggle.buttons = [
          {
            label:this._t("panel.flow_horizontal"),
            value:"horizontal",
            iconPath:FLOW_HORIZONTAL_ICON_PATH,
          },
          {
            label:this._t("panel.flow_vertical"),
            value:"vertical",
            iconPath:FLOW_VERTICAL_ICON_PATH,
          },
        ];
        toggle.active = draft?.section_flow || "horizontal";
        toggle.addEventListener("value-changed", event => {
          const value = event.detail?.value;
          if (!draft || !["horizontal", "vertical"].includes(value)) return;
          draft.section_flow = value;
          toggle.active = value;
        });
      }
      for (const panel of dialog.querySelectorAll?.("ha-expansion-panel.entity-visibility-section") || []) {
        panel.expanded = false;
      }
      if (!("headerTitle" in (customElements.get("ha-dialog")?.prototype || {}))) {
        dialog.querySelector?.("#editor-actions")?.removeAttribute("slot");
      }
      dialog.open = true;
    }

    _selectEditorHub(hub, focus = false) {
      if (!this._editorOpen || !this._config?.hubs?.includes(hub)) return;
      this._editorHub = hub;
      for (const tab of this.shadowRoot.querySelectorAll?.('[data-action="editor-hub"]') || []) {
        const selected = tab.dataset.hub === hub;
        tab.setAttribute("aria-selected", String(selected));
        tab.tabIndex = selected ? 0 : -1;
        if (selected && focus) tab.focus({preventScroll:true});
      }
      for (const editor of this.shadowRoot.querySelectorAll?.(".hub-editor") || []) {
        editor.hidden = editor.dataset.hub !== hub;
      }
      const container = this.shadowRoot.querySelector?.(".config-editor");
      if (container) container.scrollTop = 0;
    }

    _applyEditorSectionOrder(hub, visibleOrder) {
      const draft = this._editorDrafts?.[hub];
      const dialog = this.shadowRoot.querySelector?.("#config-dialog");
      const editor = Array.from(dialog?.querySelectorAll?.(".hub-editor") || [])
        .find(candidate => candidate.dataset.hub === hub);
      const entitySections = editor?.querySelector?.(".entity-visibility-sections");
      if (!draft || !entitySections) return;
      const visibleKeys = new Set(visibleOrder);
      let visibleIndex = 0;
      draft.section_order = orderedGroupKeys(draft.section_order).map(group => (
        visibleKeys.has(group) ? visibleOrder[visibleIndex++] : group
      ));
      const panels = new Map(Array.from(
        entitySections?.querySelectorAll?.(".entity-visibility-section") || [],
      ).map(panel => [panel.dataset.group, panel]));
      for (const group of visibleOrder) entitySections?.append(panels.get(group));
    }

    _sectionDragStart(event) {
      const handle = event.target.closest?.(".entity-section-drag-handle");
      const row = handle?.closest?.(".entity-visibility-section");
      if (!row) return;
      this._draggedSection = {hub:row.dataset.hub, group:row.dataset.group};
      row.classList.add("dragging");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", row.dataset.group);
      }
    }

    _sectionDropPosition(event) {
      const dragged = this._draggedSection;
      if (!dragged) return null;
      const directRow = event.target.closest?.(".entity-visibility-section");
      const container = directRow?.parentElement
        || event.target.closest?.(".entity-visibility-sections");
      if (!container || container.dataset.hub !== dragged.hub) return null;
      const rows = Array.from(container.querySelectorAll(".entity-visibility-section"))
        .filter(row => row.dataset.group !== dragged.group);
      if (!rows.length) return {container, row:null, after:false};
      if (directRow && directRow.dataset.group !== dragged.group) {
        const rect = directRow.getBoundingClientRect();
        return {container, row:directRow, after:event.clientY >= rect.top + rect.height / 2};
      }
      const nextRow = rows.find(row => {
        const rect = row.getBoundingClientRect();
        return event.clientY < rect.top + rect.height / 2;
      });
      return nextRow
        ? {container, row:nextRow, after:false}
        : {container, row:rows.at(-1), after:true};
    }

    _sectionDragOver(event) {
      const position = this._sectionDropPosition(event);
      if (!position) return;
      event.preventDefault();
      for (const candidate of position.container.querySelectorAll(".entity-visibility-section")) {
        candidate.classList.remove("drop-before", "drop-after");
      }
      position.row?.classList.add(position.after ? "drop-after" : "drop-before");
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    }

    _sectionDrop(event) {
      const dragged = this._draggedSection;
      const position = this._sectionDropPosition(event);
      if (!dragged || !position) return;
      event.preventDefault();
      if (!position.row) {
        this._clearSectionDrag();
        return;
      }
      const visibleOrder = Array.from(position.container.querySelectorAll(".entity-visibility-section"))
        .map(candidate => candidate.dataset.group)
        .filter(group => group !== dragged.group);
      const targetIndex = visibleOrder.indexOf(position.row.dataset.group);
      visibleOrder.splice(Math.max(0, targetIndex + (position.after ? 1 : 0)), 0, dragged.group);
      const currentOrder = Array.from(
        position.container.querySelectorAll(".entity-visibility-section"),
        candidate => candidate.dataset.group,
      );
      if (visibleOrder.some((group, index) => group !== currentOrder[index])) {
        this._applyEditorSectionOrder(dragged.hub, visibleOrder);
      }
      this._clearSectionDrag();
    }

    _clearSectionDrag() {
      this._draggedSection = null;
      for (const row of this.shadowRoot.querySelectorAll?.(".entity-visibility-section") || []) {
        row.classList.remove("dragging", "drop-before", "drop-after");
      }
    }

    _updateEditorState() {
      const dialog = this.shadowRoot.querySelector?.("#config-dialog");
      if (!dialog || !this._editorOpen) return;
      for (const button of dialog.querySelectorAll?.('[data-action="editor-cancel"], [data-action="editor-save"]') || []) {
        button.disabled = this._savingSettings;
      }
      const error = dialog.querySelector?.(".editor-error");
      if (error) error.textContent = this._editorError;
    }

    _control(entry, state) {
      const id = esc(entry.entity_id), domain = domainOf(entry.entity_id);
      const disabled = this._busy.has(entry.entity_id)
        ? ' disabled aria-busy="true"'
        : "";
      if (unavailable(state)) return "";
      if (["switch", "light"].includes(domain)) {
        const active = state.state === "on";
        const actionLabel = this._t(active ? "common.turn_off" : "common.turn_on");
        return `<button
          class="mini toggle ${active ? "active" : ""}"
          data-action="service"
          data-domain="${domain}"
          data-service="turn_${active ? "off" : "on"}"
          data-entity="${id}"
          aria-label="${actionLabel}"
          ${disabled}
        ><ha-icon icon="mdi:power"></ha-icon></button>`;
      }
      if (domain === "cover") return `<div class="row-actions">
        <button
          class="mini"
          data-action="service"
          data-domain="cover"
          data-service="open_cover"
          data-entity="${id}"
          aria-label="${this._t("common.open")}"
          ${disabled}
        ><ha-icon icon="mdi:arrow-up"></ha-icon></button>
        <button
          class="mini"
          data-action="service"
          data-domain="cover"
          data-service="stop_cover"
          data-entity="${id}"
          aria-label="${this._t("common.stop")}"
          ${disabled}
        ><ha-icon icon="mdi:stop"></ha-icon></button>
        <button
          class="mini"
          data-action="service"
          data-domain="cover"
          data-service="close_cover"
          data-entity="${id}"
          aria-label="${this._t("common.close")}"
          ${disabled}
        ><ha-icon icon="mdi:arrow-down"></ha-icon></button>
      </div>`;
      if (domain === "button") {
        return `<button
          class="action-button"
          data-action="service"
          data-domain="button"
          data-service="press"
          data-entity="${id}"
          ${disabled}
        >${this._t("common.run")}</button>`;
      }
      if (domain === "select") {
        const options = Array.isArray(state.attributes.options) ? state.attributes.options : [];
        const optionMarkup = options
          .map(option => `<option ${option === state.state ? "selected" : ""}>${esc(option)}</option>`)
          .join("");
        return `<select
          data-action="select"
          data-entity="${id}"
          aria-label="${esc(this._t("common.choose", {name:entityName(state, entry, this._hass)}))}"
          ${disabled}
        >${optionMarkup}</select>`;
      }
      if (["number", "input_number"].includes(domain)) {
        const min = Number(state.attributes.min);
        const max = Number(state.attributes.max);
        const step = Number(state.attributes.step) || 1;
        if (Number.isFinite(min) && Number.isFinite(max) && numeric(state)) {
          return `<label class="range">
            <input
              type="range"
              data-action="number"
              data-domain="${domain}"
              data-entity="${id}"
              aria-label="${esc(entityName(state, entry, this._hass))}"
              min="${min}"
              max="${max}"
              step="${step}"
              value="${Number(state.state)}"
              ${disabled}
            >
            <span>${esc(this._formatState(state))}</span>
          </label>`;
        }
      }
      return `<button class="more" data-action="more" data-entity="${id}">
        ${this._t("common.details")}
      </button>`;
    }

    _entityRow({entry, state}) {
      const alert = unavailable(state);
      const entityId = esc(entry.entity_id);
      return `<article class="entity-row ${alert ? "unavailable" : ""}">
        <button class="entity-main" data-action="more" data-entity="${entityId}">
          <span class="entity-icon">
            <ha-state-icon data-state-icon="${entityId}"></ha-state-icon>
          </span>
          <span class="entity-copy">
            <strong>${esc(entityName(state, entry, this._hass))}</strong>
            ${this._hubSettings().show_entity_ids ? `<small>${entityId}</small>` : ""}
          </span>
          <span class="entity-state">
            <state-display data-state-display="${entityId}"></state-display>
            <small>${esc(relativeTime(state?.last_changed, this._hass))}</small>
          </span>
        </button>
        ${this._control(entry, state)}
      </article>`;
    }

    _charts() {
      if (this._hiddenSections().has("history")) return "";
      const candidates = this._chartEntities();
      if (!candidates.length) return "";
      return `<details class="charts-section" open>
        <summary class="section-heading">
          <div>
            <span class="eyebrow">${this._t("panel.last_24_hours")}</span>
            <h2>${this._t("panel.at_a_glance")}</h2>
          </div>
          <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
        </summary>
        <button
          class="refresh"
          data-action="history"
          aria-label="${esc(this._t("common.refresh"))}"
          title="${esc(this._t("common.refresh"))}"
        >
          <ha-icon icon="mdi:refresh"></ha-icon>
        </button>
        <div class="charts">${candidates.map(({entry, state}, index) => {
          const history = [...(this._history.get(entry.entity_id) || [])];
          if (numeric(state)) history.push({value:Number(state.state),time:Date.now()});
          const sampled = history.length > 96
            ? history.filter((_, item) => (
              item % Math.ceil(history.length / 96) === 0
              || item === history.length - 1
            ))
            : history;
          const graph = chartPoints(sampled);
          const minimum = graph.min === null
            ? this._t(this._historyLoading ? "common.loading" : "common.no_history")
            : this._formatHistoryValue(state, graph.min);
          const maximum = graph.max === null
            ? ""
            : this._formatHistoryValue(state, graph.max);
          return `<article class="chart-card chart-${index % 4}">
            <div class="chart-title">
              <span>
                <ha-state-icon data-state-icon="${esc(entry.entity_id)}"></ha-state-icon>
                ${esc(entityName(state, entry, this._hass))}
              </span>
              <strong>
                <state-display data-state-display="${esc(entry.entity_id)}"></state-display>
              </strong>
            </div>
            <svg
              viewBox="0 0 300 86"
              preserveAspectRatio="none"
              role="img"
              aria-label="${esc(this._t("panel.chart_history", {name:entityName(state, entry, this._hass)}))}"
            >
              <defs>
                <linearGradient id="fill-${index}" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stop-color="currentColor" stop-opacity=".28"/>
                  <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
                </linearGradient>
              </defs>
              <path class="grid-line" d="M0 22H300M0 43H300M0 64H300"/>
              ${graph.points ? `
                <polygon points="0,86 ${graph.points} 300,86" fill="url(#fill-${index})"/>
                <polyline points="${graph.points}"/>
              ` : ""}
            </svg>
            <div class="chart-foot">
              <span>${minimum}</span>
              <span>${this._t("common.now")}</span>
              <span>${maximum}</span>
            </div>
          </article>`;
        }).join("")}</div>
      </details>`;
    }

    _groups(entities) {
      const settings = this._hubSettings();
      const hiddenSections = this._hiddenSections();
      const grouped = new Map(GROUPS.map(([key]) => [key, []]));
      for (const item of entities) grouped.get(groupFor(item.entry, item.state)).push(item);
      const renderedGroups = [];
      orderedGroupKeys(settings.section_order).forEach((key, order) => {
        if (hiddenSections.has(key)) return;
        const items = grouped.get(key);
        if (!items.length) return;
        const meta = GROUP_META.get(key);
        const offline = items.filter(({state}) => unavailable(state)).length;
        const itemMarkup = items
          .sort((a, b) => (
            entityName(a.state, a.entry, this._hass)
              .localeCompare(entityName(b.state, b.entry, this._hass), languageFor(this._hass))
          ))
          .map(item => this._entityRow(item))
          .join("");
        const markup = `<details
          class="entity-group"
          data-group="${key}"
          style="--group-order:${order}"
          open
        >
          <summary>
            <span class="group-icon"><ha-icon icon="${meta.icon}"></ha-icon></span>
            <span>
              <strong>${this._t(meta.titleKey)}</strong>
              <small>
                ${items.length} ${this._t(pluralKey("panel.entity", items.length, this._hass))}
                ${offline ? ` · ${offline} ${this._t("panel.unavailable")}` : ""}
              </small>
            </span>
            <ha-icon class="chevron" icon="mdi:chevron-down"></ha-icon>
          </summary>
          <div class="entity-list">${itemMarkup}</div>
        </details>`;
        renderedGroups.push({markup, weight:items.length + 1});
      });
      const columns = sectionFlow(settings.section_flow) === "vertical"
        ? verticalGroupColumns(renderedGroups, this._groupColumnCount)
        : horizontalGroupColumns(renderedGroups, this._groupColumnCount);
      return columns
        .filter(items => items.length)
        .map(items => `<div class="group-column">${items.map(item => item.markup).join("")}</div>`)
        .join("");
    }

    _hydrateNativeEntityElements() {
      for (const icon of this.shadowRoot.querySelectorAll?.("[data-state-icon]") || []) {
        icon.stateObj = this._displayState(icon.dataset.stateIcon);
        icon.stateColor = true;
      }
      for (const display of this.shadowRoot.querySelectorAll?.("[data-state-display]") || []) {
        display.hass = this._hass;
        display.stateObj = this._displayState(display.dataset.stateDisplay);
      }
    }

    _style() { return `<style>
      :host {
        display: block;
        height: 100%;
        min-width: 0;
        overflow: auto;
        overflow-anchor: none;
        color: var(--primary-text-color);
        background: var(--primary-background-color);
        font-family: var(--ha-font-family-body,inherit);
      }
      * {
        box-sizing: border-box;
      }
      button, select, input {
        font: inherit;
      }
      button:focus-visible, select:focus-visible, summary:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }
      button:disabled, select:disabled, input:disabled {
        cursor: progress;
        opacity: .65;
      }
      .page {
        max-width: 2400px;
        margin: 0 auto;
        padding: 24px clamp(14px,3vw,40px) 56px;
      }
      .hero {
        position: relative;
        overflow: hidden;
        padding: 28px;
        border: 1px solid color-mix(in srgb,var(--primary-color) 24%,var(--divider-color));
        border-radius: 24px;
        background: linear-gradient(
          135deg,
          color-mix(in srgb,var(--primary-color) 13%,var(--card-background-color)) 0%,
          var(--card-background-color) 64%
        );
        box-shadow: var(--ha-card-box-shadow);
      }
      .hero:after {
        position: absolute;
        content: "";
        width: 310px;
        height: 310px;
        right: -90px;
        top: -180px;
        border-radius: 50%;
        background: var(--primary-color);
        opacity: .08;
      }
      .hero-top {
        position: relative;
        z-index: 1;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 20px;
      }
      .eyebrow {
        display: block;
        margin-bottom: 6px;
        color: var(--primary-color);
        font-size: 12px;
        font-weight: 700;
        letter-spacing: .1em;
        text-transform: uppercase;
      }
      .hero h1, .section-heading h2 {
        margin: 0;
        font-weight: 500;
      }
      .hero h1 {
        font-size: clamp(26px,4vw,40px);
      }
      .hub-meta {
        margin: 8px 0 0;
        color: var(--secondary-text-color);
      }
      .hero-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .diagnostics-button {
        display: flex;
        align-items: center;
        gap: 8px;
        flex: 0 0 auto;
        min-height: 40px;
        padding: 8px 13px;
        border: 1px solid var(--divider-color);
        border-radius: 12px;
        color: var(--primary-text-color);
        background: var(--secondary-background-color);
        cursor: pointer;
      }
      .hub-tabs {
        display: flex;
        min-width: 0;
        margin-bottom: 18px;
        overflow-x: auto;
        border-bottom: 1px solid var(--divider-color);
      }
      .hub-tab {
        flex: 0 0 auto;
        min-height: 48px;
        padding: 0 24px;
        border: 0;
        border-bottom: 2px solid transparent;
        color: var(--secondary-text-color);
        background: transparent;
        cursor: pointer;
      }
      .hub-tab[aria-selected="true"] {
        border-bottom-color: currentColor;
        color: var(--primary-color);
      }
      .hub-tab:focus-visible {
        outline: 2px solid currentColor;
        outline-offset: -4px;
      }
      .metrics {
        position: relative;
        z-index: 1;
        display: grid;
        grid-template-columns: repeat(4,minmax(0,1fr));
        gap: 12px;
        margin-top: 26px;
      }
      .metric {
        min-width: 0;
        padding: 14px;
        border: 1px solid color-mix(in srgb,var(--divider-color) 72%,transparent);
        border-radius: 16px;
        background: color-mix(in srgb,var(--card-background-color) 82%,transparent);
      }
      .metric strong {
        display: block;
        font-size: 24px;
        font-weight: 600;
      }
      .metric span {
        display: block;
        color: var(--secondary-text-color);
        font-size: 12px;
      }
      .metric .metric-title {
        margin-bottom: 4px;
        color: var(--primary-text-color);
        font-size: 16px;
        font-weight: 600;
      }
      .metric-detail {
        min-height: 1em;
        margin-top: 2px;
      }
      .metric.alert strong {
        color: var(--error-color);
      }
      button.metric-toggle {
        width: 100%;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      button.metric-toggle:hover {
        border-color: var(--primary-color);
      }
      button.metric-toggle:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 2px;
      }
      .toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin: 28px 0 18px;
      }
      .search {
        display: flex;
        align-items: center;
        flex: 1;
        max-width: 520px;
        padding: 0 14px;
        border: 1px solid var(--divider-color);
        border-radius: 14px;
        background: var(--card-background-color);
      }
      .search ha-icon {
        color: var(--secondary-text-color);
      }
      .search input {
        width: 100%;
        padding: 13px 10px;
        border: 0;
        outline: 0;
        color: var(--primary-text-color);
        background: transparent;
      }
      .search:focus-within {
        border-color: var(--primary-color);
        box-shadow: 0 0 0 1px var(--primary-color);
      }
      .status-line {
        color: var(--secondary-text-color);
        font-size: 13px;
      }
      .alerts {
        display: grid;
        grid-template-columns: repeat(auto-fit,minmax(250px,1fr));
        gap: 10px;
        margin: 18px 0;
      }
      .alerts[hidden] {
        display: none;
      }
      .alerts:focus-visible {
        outline: 2px solid var(--primary-color);
        outline-offset: 4px;
        border-radius: 14px;
      }
      .alert-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 13px 15px;
        border-radius: 14px;
        background: color-mix(in srgb,var(--warning-color,#f6a623) 12%,var(--card-background-color));
        color: var(--primary-text-color);
      }
      .alert-card.error {
        background: color-mix(in srgb,var(--error-color) 12%,var(--card-background-color));
      }
      .alert-card ha-icon {
        color: var(--warning-color,#f6a623);
      }
      .alert-card.error ha-icon {
        color: var(--error-color);
      }
      .config-editor {
        width: 100%;
        max-width: 100%;
        max-height: min(70vh,760px);
        overflow-x: hidden;
        overflow-y: auto;
        color: var(--primary-text-color);
      }
      .config-editor > p {
        margin: 0 0 20px;
        color: var(--secondary-text-color);
      }
      .config-editor h2 {
        margin: 0 0 12px;
        font-size: 18px;
        font-weight: 500;
      }
      .editor-hub-tabs {
        position: sticky;
        z-index: 2;
        top: 0;
        display: flex;
        min-width: 0;
        margin: 0 0 20px;
        overflow-x: auto;
        border-bottom: 1px solid var(--divider-color);
        background: var(--primary-background-color, var(--ha-color-surface-default,#fff));
      }
      .editor-hub-tab {
        flex: 0 0 auto;
        min-height: 48px;
        padding: 0 20px;
        border: 0;
        border-bottom: 2px solid transparent;
        color: var(--secondary-text-color);
        background: transparent;
        cursor: pointer;
      }
      .editor-hub-tab[aria-selected="true"] {
        border-bottom-color: var(--primary-color);
        color: var(--primary-text-color);
      }
      .hub-editor > p {
        margin: 0 0 20px;
        color: var(--secondary-text-color);
      }
      .hub-editor > section + section {
        margin-top: 24px;
      }
      .hub-editor > section > h3 {
        margin: 0 0 12px;
        font-size: 15px;
        font-weight: 500;
      }
      .entity-visibility-sections {
        display: grid;
        gap: 16px;
        min-width: 0;
      }
      .standalone-section-toggle {
        display: grid;
        grid-template-columns: auto minmax(0,1fr) auto;
        align-items: center;
        gap: 12px;
        min-width: 0;
        padding: 12px 14px;
        border: 1px solid var(--divider-color);
        border-radius: var(--ha-border-radius-md,12px);
      }
      .standalone-section-toggle ha-icon {
        color: var(--primary-color);
      }
      .entity-id-toggle, .section-flow-setting {
        margin-bottom: 24px;
      }
      .section-flow-options {
        --button-toggle-icon-size: 22px;
      }
      .entity-visibility-section {
        display: block;
        min-width: 0;
        overflow: hidden;
        transition: opacity .15s ease, box-shadow .15s ease;
        --expansion-panel-content-padding: 0;
        --ha-card-border-radius: var(--ha-border-radius-md,12px);
      }
      .entity-visibility-section.dragging {
        opacity: .45;
      }
      .entity-visibility-section.drop-before {
        box-shadow: inset 0 3px 0 var(--primary-color);
      }
      .entity-visibility-section.drop-after {
        box-shadow: inset 0 -3px 0 var(--primary-color);
      }
      .entity-section-header {
        display: grid;
        grid-template-columns: auto minmax(0,1fr) auto auto;
        align-items: center;
        gap: 10px;
        width: 100%;
        min-width: 0;
        font-size: 15px;
        font-weight: 500;
      }
      .entity-section-icon {
        color: var(--primary-color);
      }
      .entity-section-header small {
        color: var(--secondary-text-color);
        font-size: 12px;
        font-weight: 400;
      }
      .entity-section-drag-handle {
        color: var(--secondary-text-color);
        cursor: grab;
      }
      .entity-visibility-section.dragging .entity-section-drag-handle {
        cursor: grabbing;
      }
      .entity-visibility-section .visibility-list {
        gap: 0;
        border-top: 1px solid var(--divider-color);
      }
      .entity-visibility-section .visibility-row {
        border: 0;
        border-radius: 0;
      }
      .entity-visibility-section .visibility-row + .visibility-row {
        border-top: 1px solid var(--divider-color);
      }
      .visibility-list {
        display: grid;
        grid-template-columns: 1fr;
        gap: 8px;
        width: 100%;
        min-width: 0;
      }
      .visibility-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        width: 100%;
        max-width: 100%;
        min-width: 0;
        overflow: hidden;
        padding: 10px 12px;
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        cursor: pointer;
      }
      .visibility-row span {
        display: block;
        overflow: hidden;
        min-width: 0;
      }
      .visibility-row small {
        display: block;
        overflow: hidden;
        margin-top: 2px;
        color: var(--secondary-text-color);
        font-size: 11px;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dialog-actions {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 8px;
        width: 100%;
      }
      .editor-version {
        margin-right: auto;
        color: var(--secondary-text-color);
        font-size: 12px;
      }
      .editor-error:empty { display: none; }
      .editor-error {
        color: var(--error-color) !important;
      }
      .detail-list {
        display: flex;
        flex-wrap: wrap;
        gap: 4px 12px;
        margin-top: 4px;
      }
      .detail-link {
        padding: 0;
        border: 0;
        color: var(--primary-color);
        background: transparent;
        text-align: left;
        text-decoration: underline;
        text-underline-offset: 2px;
        cursor: pointer;
      }
      .section-heading {
        display: flex;
        align-items: end;
        justify-content: space-between;
        margin: 30px 0 14px;
        cursor: pointer;
        list-style: none;
        padding-right: 52px;
      }
      .section-heading::-webkit-details-marker {
        display: none;
      }
      .charts-section {
        position: relative;
      }
      .charts-section[open] > .section-heading .chevron {
        position: absolute;
        top: 12px;
        right: 0;
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
      }
      .charts-section:not([open]) .section-heading {
        margin-bottom: 0;
        padding-right: 0;
      }
      .charts-section:not([open]) .chevron {
        transform: rotate(-90deg);
      }
      .refresh {
        position: absolute;
        top: 12px;
        right: 52px;
        display: grid;
        place-items: center;
        width: 40px;
        height: 40px;
        border: 1px solid var(--divider-color);
        border-radius: 50%;
        color: var(--secondary-text-color);
        background: var(--card-background-color);
        cursor: pointer;
      }
      .refresh ha-icon {
        --mdc-icon-size: 22px;
      }
      .charts-section:not([open]) .refresh {
        display: none;
      }
      .charts {
        display: grid;
        grid-template-columns: repeat(3,minmax(0,1fr));
        gap: 14px;
      }
      .chart-card {
        padding: 16px;
        border: 1px solid var(--divider-color);
        border-radius: 18px;
        background: var(--card-background-color);
        box-shadow: var(--ha-card-box-shadow);
        color: var(--primary-color);
      }
      .chart-1 {
        color: var(--info-color,#039be5);
      }
      .chart-2 {
        color: var(--warning-color,#f6a623);
      }
      .chart-3 {
        color: var(--success-color,#43a047);
      }
      .chart-title {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        color: var(--primary-text-color);
      }
      .chart-title>span {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        font-size: 13px;
      }
      .chart-title>span ha-state-icon {
        color: currentColor;
      }
      .chart-title strong {
        font-size: 20px;
      }
      .chart-card svg {
        display: block;
        width: 100%;
        height: 96px;
        margin-top: 12px;
        overflow: visible;
      }
      .chart-card polyline {
        fill: none;
        stroke: currentColor;
        stroke-width: 2.5;
        vector-effect: non-scaling-stroke;
      }
      .grid-line {
        fill: none;
        stroke: var(--divider-color);
        stroke-width: 1;
        vector-effect: non-scaling-stroke;
      }
      .chart-foot {
        display: flex;
        justify-content: space-between;
        color: var(--secondary-text-color);
        font-size: 10px;
      }
      .groups {
        display: grid;
        grid-template-columns: repeat(var(--group-columns,1),minmax(0,1fr));
        gap: 16px;
        align-items: start;
        margin-top: 28px;
      }
      .group-column {
        display: flex;
        flex-direction: column;
        gap: 16px;
        min-width: 0;
      }
      .entity-group {
        min-width: 0;
        overflow: hidden;
        border: 1px solid var(--divider-color);
        border-radius: 18px;
        background: var(--card-background-color);
        box-shadow: var(--ha-card-box-shadow);
      }
      .entity-group summary {
        display: grid;
        grid-template-columns: 42px minmax(0,1fr) 24px;
        align-items: center;
        gap: 10px;
        padding: 15px 16px;
        cursor: pointer;
        list-style: none;
      }
      .entity-group summary::-webkit-details-marker {
        display: none;
      }
      .group-icon, .entity-icon {
        display: grid;
        place-items: center;
        border-radius: 12px;
        background: color-mix(in srgb,var(--primary-color) 14%,transparent);
      }
      .group-icon {
        width: 42px;
        height: 42px;
        color: var(--primary-color);
      }
      .entity-group summary strong, .entity-group summary small {
        display: block;
      }
      .entity-group summary small {
        margin-top: 2px;
        color: var(--secondary-text-color);
        font-size: 11px;
      }
      .chevron {
        color: var(--secondary-text-color);
        transition: transform .2s;
      }
      .entity-group:not([open]) .chevron {
        transform: rotate(-90deg);
      }
      .entity-list {
        border-top: 1px solid var(--divider-color);
      }
      .entity-row {
        display: flex;
        align-items: center;
        min-height: 64px;
        padding: 7px 12px;
        border-bottom: 1px solid color-mix(in srgb,var(--divider-color) 65%,transparent);
      }
      .entity-row:last-child {
        border-bottom: 0;
      }
      .entity-row.unavailable {
        opacity: .58;
      }
      .entity-main {
        display: grid;
        grid-template-columns: 40px minmax(0,1fr) auto;
        align-items: center;
        gap: 10px;
        flex: 1;
        min-width: 0;
        padding: 0;
        border: 0;
        color: inherit;
        text-align: left;
        background: transparent;
        cursor: pointer;
      }
      .entity-icon {
        width: 38px;
        height: 38px;
        border-radius: 50%;
      }
      .entity-copy, .entity-state {
        min-width: 0;
      }
      .entity-copy strong, .entity-copy small, .entity-state small {
        display: block;
      }
      .entity-copy strong {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font-size: 14px;
      }
      .entity-copy small, .entity-state small {
        margin-top: 2px;
        color: var(--secondary-text-color);
        font-size: 10px;
      }
      .entity-state {
        padding-left: 10px;
        text-align: right;
        font-size: 13px;
      }
      .entity-state state-display {
        display: block;
      }
      .mini, .more, .action-button {
        border: 0;
        border-radius: 10px;
        cursor: pointer;
      }
      .mini {
        display: grid;
        place-items: center;
        width: 38px;
        height: 38px;
        margin-left: 8px;
        color: var(--secondary-text-color);
        background: var(--secondary-background-color);
      }
      .mini.active {
        color: var(--text-primary-color,#fff);
        background: var(--primary-color);
      }
      .row-actions {
        display: flex;
      }
      .row-actions .mini {
        margin-left: 4px;
      }
      .more, .action-button {
        margin-left: 10px;
        padding: 8px 11px;
        color: var(--primary-text-color);
        background: var(--secondary-background-color);
      }
      select {
        max-width: 150px;
        margin-left: 10px;
        padding: 8px;
        border: 1px solid var(--divider-color);
        border-radius: 10px;
        color: var(--primary-text-color);
        background: var(--secondary-background-color);
      }
      .range {
        display: flex;
        align-items: center;
        gap: 6px;
        max-width: 180px;
        margin-left: 10px;
      }
      .range input {
        min-width: 70px;
        width: 110px;
      }
      .range span {
        min-width: 42px;
        font-size: 11px;
      }
      .message {
        margin: 24px;
        padding: 18px;
        border-radius: 16px;
        background: var(--card-background-color);
      }
      .message.error {
        color: var(--error-color);
      }
      .empty {
        grid-column: 1/-1;
        padding: 40px;
        text-align: center;
        color: var(--secondary-text-color);
      }
      @media (max-width: 1000px) {
        .metrics {
          grid-template-columns: repeat(2,minmax(0,1fr));
        }
        .charts {
          grid-template-columns: repeat(2,minmax(0,1fr));
        }
      }
      @media (max-width: 720px) {
        .page {
          padding-top: 14px;
        }
        .hero {
          padding: 20px;
          border-radius: 18px;
        }
        .hero-top {
          min-height: 44px;
          display: block;
        }
        .hero-actions {
          position: absolute;
          top: 0;
          right: 0;
        }
        .diagnostics-button {
          position: static;
          justify-content: center;
          width: 44px;
          height: 44px;
          min-height: 44px;
          padding: 0;
          border-radius: 50%;
        }
        .diagnostics-label {
          display: none;
        }
        .editor-version { max-width: 42%; }
        .hub-tab {
          padding: 0 12px;
        }
        .metrics {
          grid-template-columns: repeat(2,minmax(0,1fr));
          gap: 8px;
        }
        .metric:last-child:nth-child(odd) {
          grid-column: 1/-1;
        }
        .toolbar {
          align-items: stretch;
          flex-direction: column;
        }
        .search {
          max-width: none;
        }
        .charts {
          grid-template-columns: 1fr;
        }
        .groups {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .group-column {
          display: contents;
        }
        .entity-group {
          display: block;
          order: var(--group-order);
        }
        .entity-state small {
          display: none;
        }
        .entity-main {
          grid-template-columns: 38px minmax(0,1fr) auto;
        }
        .row-actions .mini:nth-child(2) {
          display: none;
        }
        .range {
          max-width: 130px;
        }
        .range input {
          width: 75px;
        }
      }
    </style>`; }

    _render() {
      const scrollContainer = this.shadowRoot.host;
      const scrollTop = scrollContainer?.scrollTop || 0;
      const search = this.shadowRoot.querySelector?.("#search");
      const searchFocused = Boolean(search && this.shadowRoot.activeElement === search);
      const selection = searchFocused ? [search.selectionStart, search.selectionEnd] : null;
      const activeElement = this.shadowRoot.activeElement;
      const focusedHub = this._pendingHubFocus
        || (activeElement?.dataset?.action === "hub" ? activeElement.dataset.hub : undefined);
      this._captureSectionState();
      if (!this._hass || !this._config) {
        const panelContent = this.shadowRoot.querySelector?.("#panel-content") || this.shadowRoot;
        panelContent.innerHTML = `${this._style()}<p class="message">
          ${this._t("panel.loading")}
        </p>`;
        return;
      }
      const entities = this._visibleEntities();
      const sectionState = this._sectionState();
      const summary = this._summary();
      const hub = this._hubDevice();
      const hubs = this._config.hubs || [];
      const alertCount = summary.offline.length + summary.batteries.length;
      if (!alertCount) this._attentionOpen = false;
      if (!summary.disabledDevices.length) this._disabledDevicesOpen = false;
      if (!summary.disabled.length) this._disabledEntitiesOpen = false;
      const disabledDeviceLinks = summary.disabledDevices.map(device => {
        const name = device.name_by_user || device.name || device.model || device.id;
        return `<a
          class="detail-link"
          href="/config/devices/device/${encodeURIComponent(device.id)}"
          aria-label="${esc(`${this._t("common.details")}: ${name}`)}"
        >${esc(name)}</a>`;
      }).join("");
      const disabledEntityLinks = summary.disabled.map(entry => {
        const name = entityName(this._hass?.states?.[entry.entity_id], entry, this._hass);
        return `<button
          type="button"
          class="detail-link"
          data-action="more"
          data-entity="${esc(entry.entity_id)}"
          aria-label="${esc(`${this._t("common.details")}: ${name}`)}"
        >${esc(name)}</button>`;
      }).join("");
      const offlineNames = summary.offline
        .map(({entry, state}) => entityName(state, entry, this._hass))
        .join(", ");
      const batteryNames = summary.batteries
        .map(({entry, state}) => `${entityName(state, entry, this._hass)} (${this._formatState(state)})`)
        .join(", ");
      const entityGroups = this._groups(entities);
      const hubMetadata = [
        hub?.manufacturer,
        hub?.model,
        hub?.sw_version ? this._t("panel.firmware", {version:hub.sw_version}) : "",
      ].filter(Boolean).join(" · ") || this._t("panel.live_overview");
      const diagnosticsButton = this._hass.user?.is_admin && this._hubId()
        ? `<button
            type="button"
            class="diagnostics-button"
            data-action="diagnostics"
            aria-label="${esc(this._t("panel.download_diagnostics"))}"
            ${this._diagnosticsBusy ? 'disabled aria-busy="true"' : ""}
          >
            <ha-icon icon="mdi:download"></ha-icon>
            <span class="diagnostics-label">${this._t("panel.download_diagnostics")}</span>
          </button>`
        : "";
      const heroActions = diagnosticsButton
        ? `<div class="hero-actions">${diagnosticsButton}</div>`
        : "";
      const hubTabs = hubs.length > 1 ? `<nav
        class="hub-tabs"
        role="tablist"
        aria-label="${esc(this._t("panel.wiser_hubs"))}"
      >
        ${hubs.map((name, index) => `<button
          type="button"
          id="hub-tab-${index}"
          class="hub-tab"
          role="tab"
          aria-controls="hub-panel-content"
          aria-selected="${name === this._hub}"
          tabindex="${name === this._hub ? 0 : -1}"
          data-action="hub"
          data-hub="${esc(name)}"
        >${esc(name)}</button>`).join("")}
      </nav>` : "";
      const activeHubIndex = Math.max(0, hubs.indexOf(this._hub));
      const hubPanelAttributes = hubs.length > 1
        ? ` role="tabpanel" aria-labelledby="hub-tab-${activeHubIndex}"`
        : "";
      const offlineAlert = summary.offline.length ? `<div class="alert-card error">
        <ha-icon icon="mdi:alert-circle-outline"></ha-icon>
        <span>
          <strong>${this._t("panel.unavailable_count", {count:summary.offline.length})}</strong><br>
          <small>${esc(offlineNames)}</small>
        </span>
      </div>` : "";
      const batteryAlert = summary.batteries.length ? `<div class="alert-card">
        <ha-icon icon="mdi:battery-alert"></ha-icon>
        <span>
          <strong>${this._plural("panel.low_battery", summary.batteries.length)}</strong><br>
          <small>${esc(batteryNames)} · ${this._t("panel.below_twenty_percent")}</small>
        </span>
      </div>` : "";
      const alerts = offlineAlert || batteryAlert
        ? `<div
            id="attention-details"
            class="alerts"
            role="region"
            tabindex="-1"
            aria-label="${esc(this._t("panel.attention_details"))}"
            ${this._attentionOpen ? "" : "hidden"}
          >${offlineAlert}${batteryAlert}</div>`
        : "";
      const disabledDeviceDetails = summary.disabledDevices.length
        ? `<div
            id="disabled-devices-details"
            class="alerts"
            role="region"
            tabindex="-1"
            aria-label="${esc(this._t("panel.disabled_devices_details"))}"
            ${this._disabledDevicesOpen ? "" : "hidden"}
          ><div class="alert-card">
            <ha-icon icon="mdi:devices"></ha-icon>
            <span>
              <strong>${this._plural("panel.disabled_device", summary.disabledDevices.length)}</strong><br>
              <span class="detail-list">${disabledDeviceLinks}</span>
            </span>
          </div></div>`
        : "";
      const disabledEntityDetails = summary.disabled.length
        ? `<div
            id="disabled-entities-details"
            class="alerts"
            role="region"
            tabindex="-1"
            aria-label="${esc(this._t("panel.disabled_entities_details"))}"
            ${this._disabledEntitiesOpen ? "" : "hidden"}
          ><div class="alert-card">
            <ha-icon icon="mdi:cancel"></ha-icon>
            <span>
              <strong>${this._plural("panel.disabled_entity", summary.disabled.length)}</strong><br>
              <span class="detail-list">${disabledEntityLinks}</span>
            </span>
          </div></div>`
        : "";
      const deviceMetric = summary.disabledDevices.length
        ? `<button
            type="button"
            class="metric device-metric metric-toggle"
            data-action="disabled-devices"
            aria-controls="disabled-devices-details"
            aria-expanded="${this._disabledDevicesOpen}"
            aria-label="${esc(this._t(this._disabledDevicesOpen ? "panel.hide_disabled_devices" : "panel.show_disabled_devices"))}"
          >
            <span class="metric-title">${this._t(pluralKey("panel.device", summary.devices.length, this._hass))}</span>
            <strong>${summary.devices.length - summary.disabledDevices.length} / ${summary.disabledDevices.length}</strong>
            <span class="metric-detail">${this._t("panel.enabled_disabled")}</span>
          </button>`
        : `<div class="metric device-metric">
            <span class="metric-title">${this._t(pluralKey("panel.device", summary.devices.length, this._hass))}</span>
            <strong>${summary.devices.length} / 0</strong>
            <span class="metric-detail">${this._t("panel.enabled_disabled")}</span>
          </div>`;
      const entityMetric = summary.disabled.length
        ? `<button
            type="button"
            class="metric metric-toggle"
            data-action="disabled-entities"
            aria-controls="disabled-entities-details"
            aria-expanded="${this._disabledEntitiesOpen}"
            aria-label="${esc(this._t(this._disabledEntitiesOpen ? "panel.hide_disabled_entities" : "panel.show_disabled_entities"))}"
          >
            <span class="metric-title">${this._t("panel.entities")}</span>
            <strong>${summary.enabled.length} / ${summary.disabled.length}</strong>
            <span class="metric-detail">${this._t("panel.enabled_disabled")}</span>
          </button>`
        : `<div class="metric">
            <span class="metric-title">${this._t("panel.entities")}</span>
            <strong>${summary.enabled.length} / 0</strong>
            <span class="metric-detail">${this._t("panel.enabled_disabled")}</span>
          </div>`;
      const attentionMetric = alertCount
        ? `<button
            type="button"
            class="metric metric-toggle alert"
            data-action="attention"
            aria-controls="attention-details"
            aria-expanded="${this._attentionOpen}"
            aria-label="${esc(this._t(this._attentionOpen ? "panel.hide_attention" : "panel.show_attention"))}"
          >
            <span class="metric-title">${this._t("panel.needs_attention")}</span>
            <strong>${alertCount}</strong>
          </button>`
        : `<div class="metric">
            <span class="metric-title">${this._t("panel.needs_attention")}</span>
            <strong>${alertCount}</strong>
          </div>`;
      const content = this._loading
        ? `<p class="message">${this._t("panel.discovering_entities")}</p>`
        : `${this._charts()}
          <div
            class="groups flow-${sectionFlow(this._hubSettings().section_flow)}"
            style="--group-columns:${this._groupColumnCount}"
          >
            ${entityGroups || (!entities.length ? `<p class="empty">${this._t("panel.empty")}</p>` : "")}
          </div>`;

      const panelContent = this.shadowRoot.querySelector?.("#panel-content") || this.shadowRoot;
      panelContent.innerHTML = `${this._style()}<div class="page">
        ${hubTabs}
        <div id="hub-panel-content" data-hub="${esc(this._hub)}"${hubPanelAttributes}>
        <section class="hero">
          <div class="hero-top">
            <div>
              <span class="eyebrow">${this._t("panel.wiser_hub")}</span>
              <h1>${esc(this._hub || this._t("panel.hub_overview"))}</h1>
              <p class="hub-meta">${esc(hubMetadata)}</p>
            </div>
            ${heroActions}
          </div>
          <div class="metrics">
            <div class="metric">
              <span class="metric-title">${this._t(pluralKey("panel.room", summary.rooms.length, this._hass))}</span>
              <strong>${summary.rooms.length}</strong>
            </div>
            ${deviceMetric}
            ${entityMetric}
            ${attentionMetric}
          </div>
        </section>
        ${this._error ? `<div class="message error" role="alert">
          ${esc(this._error)}
          <button data-action="retry">${this._t("common.retry")}</button>
        </div>` : ""}
        ${disabledDeviceDetails}
        ${disabledEntityDetails}
        ${alerts}
        <div class="toolbar">
          <label class="search">
            <ha-icon icon="mdi:magnify"></ha-icon>
            <input
              id="search"
              type="search"
              value="${esc(this._query)}"
              aria-label="${esc(this._t("panel.search"))}"
              placeholder="${esc(this._t("panel.search"))}"
            >
          </label>
          <span class="status-line">
            ${this._loading
              ? this._t("panel.discovering")
              : this._t("panel.hub_entities_shown", {count:entities.length})}
          </span>
        </div>
        ${content}
        </div>
      </div>`;
      this._hydrateNativeEntityElements();
      for (const group of this.shadowRoot.querySelectorAll?.("details.entity-group") || []) {
        if (sectionState.closedGroups.has(group.dataset.group)) group.open = false;
      }
      if (!sectionState.chartsOpen) {
        const nextCharts = this.shadowRoot.querySelector?.("details.charts-section");
        if (nextCharts) nextCharts.open = false;
      }
      if (selection) {
        const nextSearch = this.shadowRoot.querySelector("#search");
        nextSearch?.focus({preventScroll:true});
        nextSearch?.setSelectionRange(...selection);
      }
      if (focusedHub) {
        const nextTab = Array.from(
          this.shadowRoot.querySelectorAll?.('[role="tab"][data-action="hub"]') || [],
        ).find(tab => tab.dataset.hub === focusedHub);
        nextTab?.focus({preventScroll:true});
        this._pendingHubFocus = undefined;
      }
      // Restore the scroll position only after the new DOM has its final shape.
      // Collapsing details above the viewport after restoring scroll allows the
      // browser's scroll anchoring to move the panel on every state update.
      if (scrollContainer) scrollContainer.scrollTop = scrollTop;
    }

    async _click(event) {
      const target = event.target.closest?.("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      if (action === "more") {
        this.dispatchEvent(new CustomEvent("hass-more-info", {detail:{entityId:target.dataset.entity},bubbles:true,composed:true}));
      } else if (action === "service") {
        const entityId = target.dataset.entity;
        if (this._busy.has(entityId)) return;
        this._busy.add(entityId);
        const optimistic = target.dataset.service === "turn_on" ? "on"
          : target.dataset.service === "turn_off" ? "off"
          : target.dataset.service === "open_cover" ? "opening"
          : target.dataset.service === "close_cover" ? "closing" : null;
        if (optimistic) this._showOptimistic(entityId, optimistic);
        else this._renderSoon();
        try {
          await this._hass.callService(target.dataset.domain, target.dataset.service, {entity_id:entityId});
          this._clearError();
        } catch (error) {
          if (optimistic) this._optimistic.delete(entityId);
          this._error = this._t("panel.control_error", {error:error.message || error});
          this._renderSoon();
        } finally {
          this._busy.delete(entityId);
          this._renderSoon();
        }
      } else if (action === "hub") {
        this._selectHub(target.dataset.hub);
      } else if (action === "diagnostics") {
        await this._downloadDiagnostics();
      } else if (action === "editor-hub") {
        this._selectEditorHub(target.dataset.hub);
      } else if (action === "editor-cancel") {
        this._closeEditor();
      } else if (action === "editor-save") {
        await this._saveEditor();
      } else if (["attention", "disabled-devices", "disabled-entities"].includes(action)) {
        const toggles = {
          attention:["#attention-details", "_attentionOpen", "panel.show_attention", "panel.hide_attention"],
          "disabled-devices":["#disabled-devices-details", "_disabledDevicesOpen", "panel.show_disabled_devices", "panel.hide_disabled_devices"],
          "disabled-entities":["#disabled-entities-details", "_disabledEntitiesOpen", "panel.show_disabled_entities", "panel.hide_disabled_entities"],
        };
        const [selector, stateProperty, showKey, hideKey] = toggles[action];
        const details = this.shadowRoot.querySelector(selector);
        if (!details) return;
        this[stateProperty] = details.hidden;
        details.hidden = !this[stateProperty];
        target.setAttribute("aria-expanded", String(this[stateProperty]));
        target.setAttribute("aria-label", this._t(this[stateProperty] ? hideKey : showKey));
        if (this[stateProperty]) {
          details.focus({preventScroll:true});
          details.scrollIntoView({behavior:"smooth", block:"nearest"});
        }
      } else if (action === "retry") this._discover(true);
      else if (action === "history") {
        event.preventDefault();
        event.stopPropagation();
        this._loadHistory();
      }
    }

    async _change(event) {
      const target = event.target;
      if (target.dataset.action === "show-entity-ids") {
        const draft = this._editorDrafts?.[target.dataset.hub];
        if (draft) draft.show_entity_ids = Boolean(target.checked);
        return;
      }
      if (["visibility-section", "visibility-entity"].includes(target.dataset.action)) {
        const draft = this._editorDrafts?.[target.dataset.hub];
        if (!draft) return;
        const property = target.dataset.action === "visibility-section"
          ? "hidden_sections"
          : "hidden_entities";
        const hidden = new Set(draft[property]);
        if (target.checked) hidden.delete(target.dataset.value);
        else hidden.add(target.dataset.value);
        draft[property] = [...hidden];
        return;
      }
      if (!["select", "number"].includes(target.dataset.action)) return;
      const entityId = target.dataset.entity;
      if (this._busy.has(entityId)) return;
      this._busy.add(entityId);
      try {
        if (target.dataset.action === "select") {
          this._showOptimistic(entityId, target.value);
          await this._hass.callService("select", "select_option", {entity_id:entityId, option:target.value});
          this._clearError();
        } else if (target.dataset.action === "number") {
          this._showOptimistic(entityId, target.value);
          await this._hass.callService(target.dataset.domain, "set_value", {entity_id:entityId, value:Number(target.value)});
          this._clearError();
        }
      } catch (error) {
        this._optimistic.delete(entityId);
        this._error = this._t("panel.update_error", {error:error.message || error});
        this._renderSoon();
      } finally {
        this._busy.delete(entityId);
        this._renderSoon();
      }
    }
  }

  if (!customElements.get("wiser-hub-panel")) customElements.define("wiser-hub-panel", WiserHubPanel);
  window.WiserHubPanelTest = {
    groupFor,
    chartPoints,
    chartable,
    unavailable,
    entityName,
    groupColumnCount,
    verticalGroupColumns,
    horizontalGroupColumns,
    languageFor,
    localize,
    orderedGroupKeys,
  };
  console.info(`%c WISER HUB PANEL %c ${VERSION} `, "color:#39d353;font-weight:bold;background:#101214", "color:white;background:#555");
})();
