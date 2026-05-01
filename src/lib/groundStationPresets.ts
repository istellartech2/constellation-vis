export interface GroundStationPreset {
  name: string;
  labelJa: string;
  latitudeDeg: number;
  longitudeDeg: number;
  heightKm: number;
}

export interface GroundStationPresetGroup {
  label: string;
  presets: GroundStationPreset[];
}

export const GROUND_STATION_PRESETS: GroundStationPresetGroup[] = [
  {
    label: "日本",
    presets: [
      { name: "Wakkanai", labelJa: "稚内", latitudeDeg: 45.4156, longitudeDeg: 141.6731, heightKm: 0.003 },
      { name: "Sapporo", labelJa: "札幌", latitudeDeg: 43.0642, longitudeDeg: 141.3469, heightKm: 0.019 },
      { name: "Sendai", labelJa: "仙台", latitudeDeg: 38.2682, longitudeDeg: 140.8694, heightKm: 0.043 },
      { name: "Tokyo", labelJa: "東京", latitudeDeg: 35.6895, longitudeDeg: 139.6917, heightKm: 0.04 },
      { name: "Nagoya", labelJa: "名古屋", latitudeDeg: 35.1815, longitudeDeg: 136.9066, heightKm: 0.056 },
      { name: "Osaka", labelJa: "大阪", latitudeDeg: 34.6937, longitudeDeg: 135.5023, heightKm: 0.038 },
      { name: "Hiroshima", labelJa: "広島", latitudeDeg: 34.3853, longitudeDeg: 132.4553, heightKm: 0.011 },
      { name: "Fukuoka", labelJa: "福岡", latitudeDeg: 33.5904, longitudeDeg: 130.4017, heightKm: 0.032 },
      { name: "Kagoshima", labelJa: "鹿児島", latitudeDeg: 31.5966, longitudeDeg: 130.5571, heightKm: 0.108 },
      { name: "Naha", labelJa: "那覇", latitudeDeg: 26.2124, longitudeDeg: 127.6809, heightKm: 0.041 },
      { name: "Chichijima", labelJa: "父島(小笠原)", latitudeDeg: 27.0944, longitudeDeg: 142.1917, heightKm: 0.005 },
    ],
  },
  {
    label: "世界",
    presets: [
      { name: "New York", labelJa: "ニューヨーク", latitudeDeg: 40.7128, longitudeDeg: -74.0060, heightKm: 0.01 },
      { name: "Los Angeles", labelJa: "ロサンゼルス", latitudeDeg: 34.0522, longitudeDeg: -118.2437, heightKm: 0.085 },
      { name: "Sao Paulo", labelJa: "サンパウロ", latitudeDeg: -23.5505, longitudeDeg: -46.6333, heightKm: 0.76 },
      { name: "London", labelJa: "ロンドン", latitudeDeg: 51.5074, longitudeDeg: -0.1278, heightKm: 0.035 },
      { name: "Paris", labelJa: "パリ", latitudeDeg: 48.8566, longitudeDeg: 2.3522, heightKm: 0.035 },
      { name: "Moscow", labelJa: "モスクワ", latitudeDeg: 55.7558, longitudeDeg: 37.6173, heightKm: 0.156 },
      { name: "Cairo", labelJa: "カイロ", latitudeDeg: 30.0444, longitudeDeg: 31.2357, heightKm: 0.023 },
      { name: "Cape Town", labelJa: "ケープタウン", latitudeDeg: -33.9249, longitudeDeg: 18.4241, heightKm: 0.025 },
      { name: "Singapore", labelJa: "シンガポール", latitudeDeg: 1.3521, longitudeDeg: 103.8198, heightKm: 0.015 },
      { name: "Sydney", labelJa: "シドニー", latitudeDeg: -33.8688, longitudeDeg: 151.2093, heightKm: 0.058 },
      { name: "Svalbard", labelJa: "スバールバル", latitudeDeg: 78.2297, longitudeDeg: 15.4072, heightKm: 0.5 },
    ],
  },
];
