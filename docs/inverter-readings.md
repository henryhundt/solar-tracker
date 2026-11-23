Open **Sites → Inverter performance** on an array to compare the latest power reading and measurement time for each device. SolarEdge API sync reads equipment telemetry by serial number. AlsoEnergy API sync reads hourly average power by PV hardware ID. eGauge sync reads identified inverter power registers (for example, Inverter 1). Browser sync also attempts direct device readings. SMA reads the PV production gauge on each inverter dashboard, SolarEdge reads the hourly inverter power chart, and PowerTrack requests quarter-hour power charts for identified inverter hardware. The external feed is optional. Missing provider measurements leave a gap. A reported zero is saved.

A logger or connector for any manufacturer can POST a JSON array to `/api/sites/{siteId}/inverters` using the application's normal authenticated session. Each request accepts up to 1,000 samples, subject to the application's request body size limit. Supply a stable device ID within the site, power in watts and a measurement timestamp with a UTC offset. Zero is a valid power reading. Resending a sample updates the same device and timestamp.

```json
[{"deviceId":"serial-001","name":"West roof","powerW":2840,"timestamp":"2026-11-20T14:00:00-06:00"}]
```

**Active faults** shows the provider code and the last report time when supplied. The separate checked time tells you how old the displayed status is. SMA uses recent Incoming and Outgoing events by device and event ID. SolarEdge browser sync uses the alerts summary and the inverter inventory. Grouped alerts without a unique device or a truncated summary can leave coverage partial. An alert opening date is displayed separately when SolarEdge omits the last report time. Meter-only and power-only connections display unavailable status.

External telemetry integrations can POST a JSON array to `/api/sites/{siteId}/inverters/faults` with the same session and device IDs used for power readings. Each device snapshot replaces its previous snapshot only if its checked time is newer. Send all known active codes for that device. A complete empty list clears its faults. Omit devices when collection fails so the last successful check remains visible.

```json
[{"deviceId":"serial-001","name":"West roof","checkedAt":"2026-11-23T12:00:00Z","complete":true,"faults":[{"code":"6107","description":"Self-diagnosis","lastReportedAt":"2026-11-23T11:54:00Z"}]}]
```
