/* Dynamic Wiser hub overview panel. */
(() => {
  const VERSION = "__WISER_HUB_PANEL_VERSION__";
  const TRANSLATIONS = __WISER_HUB_TRANSLATIONS__;
  const NATIVE_KEYS = {
    "common.close":"ui.common.close",
    "common.details":"ui.common.details",
    "common.loading":"ui.init.loading",
    "common.open":"ui.common.open",
    "common.refresh":"ui.common.refresh",
    "common.retry":"ui.common.retry",
    "common.run":"ui.common.run",
    "common.stop":"ui.common.stop",
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
    const form = new Intl.PluralRules(languageFor(hass)).select(count) === "one" ? "one" : "other";
    return `${prefix}_${form}`;
  }
  const esc = value => String(value ?? "").replace(/[&<>"']/g, character => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;",
  })[character]);
  const unavailable = state => !state || state.state === "unavailable";
  const numeric = state => state && state.state !== "" && Number.isFinite(Number(state.state));
  function entityName(state, entry, hass) {
    if (state && typeof hass?.formatEntityName === "function") {
      try {
        const formatted = hass.formatEntityName(state, undefined);
        if (typeof formatted === "string" && formatted.trim()) return formatted;
      } catch (_error) {
        // Fall back to the registry and state values below.
      }
    }
    return state?.attributes?.friendly_name
      || entry?.name
      || entry?.original_name
      || entry?.entity_id
      || "";
  }
  const deviceClass = state => state?.attributes?.device_class || "";
  const domainOf = entityId => entityId?.split(".", 1)[0] || "";
  const relativeTime = (value, hass) => {
    const date = value ? new Date(value) : null;
    if (!date || !Number.isFinite(date.getTime())) return "";
    const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
    const formatter = new Intl.RelativeTimeFormat(languageFor(hass), {numeric:"auto"});
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
  const GROUP_META = new Map(GROUPS.map(([key, titleKey, icon]) => [key, {titleKey, icon}]));
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
      this._entries = [];
      this._devices = [];
      this._history = new Map();
      this._optimistic = new Map();
      this._busy = new Set();
      this._loading = true;
      this._historyLoading = false;
      this._diagnosticsBusy = false;
      this._attentionOpen = false;
      this._error = "";
      this._query = "";
      this._renderFrame = 0;
      this.shadowRoot.addEventListener("click", event => this._click(event));
      this.shadowRoot.addEventListener("keydown", event => this._keydown(event));
      this.shadowRoot.addEventListener("change", event => this._change(event));
      this.shadowRoot.addEventListener("input", event => {
        if (event.target?.id === "search") {
          this._query = event.target.value;
          this._renderSoon();
        }
      });
    }

    set panel(value) {
      const config = value?.config || {};
      this._config = config;
      const hubs = Array.isArray(config.hubs) ? config.hubs : [];
      if (!hubs.includes(this._hub)) this._hub = hubs[0];
      this._discover();
    }

    set hass(value) {
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
      if (connectionChanged || registryChanged) this._discover(true);
      else if (updateAffectsPanel || optimisticChanged) this._renderSoon();
    }

    connectedCallback() { this._renderSoon(); }
    disconnectedCallback() { if (this._renderFrame) cancelAnimationFrame(this._renderFrame); }

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

    _hubId() { return this._config?.hub_ids?.[this._hub]; }
    _integrationEntries(includeDisabled = false) {
      const hubId = this._hubId();
      return this._entries.filter(entry => (!hubId || entry.config_entry_id === hubId)
        && (includeDisabled || !entry.disabled_by));
    }
    _hubEntries(includeDisabled = false) {
      const deviceId = this._hubDevice()?.id;
      return this._integrationEntries(includeDisabled)
        .filter(entry => deviceId && entry.device_id === deviceId);
    }
    _attentionEntries() {
      const disabledDeviceIds = new Set(
        this._integrationDevices().filter(device => device.disabled_by).map(device => device.id),
      );
      return this._integrationEntries()
        .filter(entry => !entry.device_id || !disabledDeviceIds.has(entry.device_id));
    }
    _visibleEntities() {
      const query = this._query.trim().toLocaleLowerCase(this._hass?.locale?.language || this._hass?.language);
      return this._hubEntries()
        .map(entry => ({entry, state:this._displayState(entry.entity_id)}))
        .filter(item => item.state)
        .filter(({entry, state}) => {
          const searchable = `${entityName(state, entry, this._hass)} ${entry.entity_id} ${state.state}`;
          return !query || searchable.toLocaleLowerCase().includes(query);
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
    _selectHub(hub, focus = false) {
      if (!this._config?.hubs?.includes(hub)) return;
      if (focus) this._pendingHubFocus = hub;
      if (this._hub === hub) {
        if (focus) this._renderSoon();
        return;
      }
      this._hub = hub;
      this._query = "";
      this._attentionOpen = false;
      this._loadHistory();
      this._renderSoon();
    }
    _keydown(event) {
      const tab = event.target.closest?.('[role="tab"][data-action="hub"]');
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
      this._selectHub(hubs[next], true);
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
    _integrationDevices() {
      const hubId = this._hubId();
      return this._devices.filter(device => !hubId || device.config_entries?.includes(hubId));
    }
    _hubDevice() {
      const devices = this._integrationDevices();
      return devices.find(device => (
        !device.via_device_id
        && /wiser|drayton|schneider/i.test(`${device.manufacturer || ""} ${device.model || ""}`)
      ))
        || devices.find(device => !device.via_device_id);
    }
    _hubDevices() { return this._hubDevice() ? [this._hubDevice()] : []; }
    _roomDevices() {
      const prefix = `${this._hub} room `;
      return this._integrationDevices().filter(device => device.identifiers?.some(identifier => {
        if (!Array.isArray(identifier) || identifier[0] !== "wiser") return false;
        const value = identifier[1];
        return typeof value === "string"
          && value.startsWith(prefix)
          && /^\d+$/.test(value.slice(prefix.length));
      }));
    }

    _chartEntities() {
      return this._hubEntries()
        .map(entry => ({entry, state:this._hass?.states?.[entry.entity_id]}))
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
      const number = new Intl.NumberFormat(languageFor(this._hass), {
        maximumFractionDigits:2,
      }).format(value);
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
      const rooms = this._roomDevices();
      const enabled = this._hubEntries();
      const disabled = this._hubEntries(true).filter(entry => entry.disabled_by);
      const entities = this._attentionEntries()
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
            <small>${entityId}</small>
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
      const grouped = new Map(GROUPS.map(([key]) => [key, []]));
      for (const item of entities) grouped.get(groupFor(item.entry, item.state)).push(item);
      const columns = [[], []];
      const columnWeights = [0, 0];
      GROUPS.forEach(([key], order) => {
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
        const column = columnWeights[0] <= columnWeights[1] ? 0 : 1;
        columns[column].push(markup);
        columnWeights[column] += items.length + 1;
      });
      if (!columns[0].length && !columns[1].length) return "";
      return columns.map(items => `<div class="group-column">${items.join("")}</div>`).join("");
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
        max-width: 1500px;
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
      button.attention-metric {
        width: 100%;
        color: inherit;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      button.attention-metric:hover {
        border-color: var(--primary-color);
      }
      button.attention-metric:focus-visible {
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
      .charts-section:not([open]) .section-heading {
        margin-bottom: 0;
        padding-right: 0;
      }
      .charts-section:not([open]) .chevron {
        transform: rotate(-90deg);
      }
      .refresh {
        position: absolute;
        top: 30px;
        right: 0;
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
      .chart-title>span ha-icon {
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
        grid-template-columns: repeat(2,minmax(0,1fr));
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
          display: block;
        }
        .diagnostics-button {
          margin-top: 16px;
        }
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
        }
        .group-column {
          display: contents;
        }
        .entity-group {
          order: var(--group-order);
        }
        .entity-state small, .entity-copy small {
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
      const closedGroupElements = this.shadowRoot.querySelectorAll?.(
        "details.entity-group:not([open])",
      ) || [];
      const closedGroups = new Set(
        Array.from(closedGroupElements, item => item.dataset.group),
      );
      const charts = this.shadowRoot.querySelector?.("details.charts-section");
      const chartsOpen = charts ? charts.open : true;
      if (!this._hass || !this._config) {
        this.shadowRoot.innerHTML = `${this._style()}<p class="message">
          ${this._t("panel.loading")}
        </p>`;
        return;
      }
      const entities = this._visibleEntities();
      const summary = this._summary();
      const hub = this._hubDevice();
      const hubs = this._config.hubs || [];
      const alertCount = summary.offline.length + summary.batteries.length;
      if (!alertCount) this._attentionOpen = false;
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
            ${this._diagnosticsBusy ? 'disabled aria-busy="true"' : ""}
          >
            <ha-icon icon="mdi:download"></ha-icon>
            ${this._t("panel.download_diagnostics")}
          </button>`
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
      const attentionMetric = alertCount
        ? `<button
            type="button"
            class="metric attention-metric alert"
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
          <div class="groups">
            ${entityGroups || `<p class="empty">${this._t("panel.empty")}</p>`}
          </div>`;

      this.shadowRoot.innerHTML = `${this._style()}<div class="page">
        ${hubTabs}
        <div id="hub-panel-content"${hubPanelAttributes}>
        <section class="hero">
          <div class="hero-top">
            <div>
              <span class="eyebrow">${this._t("panel.wiser_hub")}</span>
              <h1>${esc(this._hub || this._t("panel.hub_overview"))}</h1>
              <p class="hub-meta">${esc(hubMetadata)}</p>
            </div>
            ${diagnosticsButton}
          </div>
          <div class="metrics">
            <div class="metric">
              <span class="metric-title">${this._t(pluralKey("panel.room", summary.rooms.length, this._hass))}</span>
              <strong>${summary.rooms.length}</strong>
            </div>
            <div class="metric device-metric">
              <span class="metric-title">${this._t(pluralKey("panel.device", summary.devices.length, this._hass))}</span>
              <strong>${summary.devices.length - summary.disabledDevices.length} / ${summary.disabledDevices.length}</strong>
              <span class="metric-detail">${this._t("panel.enabled_disabled")}</span>
            </div>
            <div class="metric">
              <span class="metric-title">${this._t("panel.entities")}</span>
              <strong>${summary.enabled.length} / ${summary.disabled.length}</strong>
              <span class="metric-detail">${this._t("panel.enabled_disabled")}</span>
            </div>
            ${attentionMetric}
          </div>
        </section>
        ${this._error ? `<div class="message error" role="alert">
          ${esc(this._error)}
          <button data-action="retry">${this._t("common.retry")}</button>
        </div>` : ""}
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
        if (closedGroups.has(group.dataset.group)) group.open = false;
      }
      if (!chartsOpen) {
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
      } else if (action === "attention") {
        const details = this.shadowRoot.querySelector("#attention-details");
        if (!details) return;
        this._attentionOpen = details.hidden;
        details.hidden = !this._attentionOpen;
        target.setAttribute("aria-expanded", String(this._attentionOpen));
        target.setAttribute("aria-label", this._t(
          this._attentionOpen ? "panel.hide_attention" : "panel.show_attention",
        ));
        if (this._attentionOpen) {
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
    languageFor,
    localize,
  };
  console.info(`%c WISER HUB PANEL %c ${VERSION} `, "color:#39d353;font-weight:bold;background:#101214", "color:white;background:#555");
})();
