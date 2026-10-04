# Wiser Hub Panel

A panel-only frontend for the Wiser Home Assistant integration. It discovers
the entities and devices exposed by each configured Wiser hub and presents
them as an overview, live controls, diagnostics and recent history charts.

The panel is installed and updated through the Wiser frontend registry. It does
not register a Lovelace card.

## Features

- Automatic per-hub discovery from Home Assistant's entity and device registries
- Dynamic groups for hub heating, hot water, environment, energy, controls,
  actions and diagnostics
- Immediate controls for switches, lights, covers, buttons, selects and numbers
- 24-hour charts for available numeric Wiser sensors
- Availability, low-battery, disabled-device and disabled-entity summaries
- Administrator visual editor for per-hub section and entity visibility
- Responsive layouts for desktop and mobile

## Development

```bash
npm test
npm run build:dev
```

The generated release asset is `dist/wiser-hub-panel.js`.
