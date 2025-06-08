import { calculateStationAccessData } from "../src/lib/visibility";

// Test data
const testSatellites = [{
  type: "tle" as const,
  lines: [
    "1 25544U 98067A   21275.52501419  .00006589  00000-0  12896-3 0  9993",
    "2 25544  51.6443 221.2140 0003031  88.1638  21.4246 15.48861704305116"
  ],
  meta: { objectName: "ISS (ZARYA)" }
}];

const testStations = [{
  name: "Tokyo",
  latitudeDeg: 35.6762,
  longitudeDeg: 139.6503,
  heightKm: 0,
  minElevationDeg: 10
}];

const startTime = new Date("2021-10-02T00:00:00Z");

console.log("Testing calculateStationAccessData with 10 second intervals...");

const data = calculateStationAccessData(
  testSatellites,
  testStations,
  startTime,
  1, // 1 hour for testing
  10 // 10 seconds
);

console.log(`Total data points: ${data.length}`);
console.log(`Expected data points for 1 hour at 10s intervals: ${(60 * 60) / 10 + 1}`);
console.log(`First 5 timestamps:`);
data.slice(0, 5).forEach((d, i) => {
  console.log(`  ${i}: ${d.time} (timestamp: ${d.timestamp})`);
});

// Check interval
if (data.length > 1) {
  const interval = data[1].timestamp - data[0].timestamp;
  console.log(`Actual interval between data points: ${interval}ms (expected: 10000ms)`);
}