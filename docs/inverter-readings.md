Open **Sites → Inverter performance** on an array to compare the latest power reading and measurement time for each device. SolarEdge API sync reads equipment telemetry by serial number. AlsoEnergy API sync reads hourly average power by PV hardware ID. eGauge sync reads identified inverter power registers (for example, Inverter 1). Browser sync also attempts direct device readings. SMA reads the PV production gauge on each inverter dashboard, SolarEdge reads the hourly inverter power chart, and PowerTrack requests quarter-hour power charts for identified inverter hardware. The external feed is optional. Missing provider measurements leave a gap. A reported zero is saved.

A logger or connector for any manufacturer can POST a JSON array to `/api/sites/{siteId}/inverters` using the application's normal authenticated session. Each request accepts up to 1,000 samples, subject to the application's request body size limit. Supply a stable device ID within the site, power in watts and a measurement timestamp with a UTC offset. Zero is a valid power reading. Resending a sample updates the same device and timestamp.

```json
[{"deviceId":"serial-001","name":"West roof","powerW":2840,"timestamp":"2026-11-20T14:00:00-06:00"}]
```
