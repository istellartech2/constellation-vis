import { describe, it, expect } from "bun:test";
import {
  createDefaultIslSettings,
  reconcileIslEndpoints,
  stationEndpoint,
  type IslEndpoint,
} from "../src/lib/isl/types";
import type { GroundStation } from "../src/lib/groundStations";

function gs(name: string, latitudeDeg: number): GroundStation {
  return { name, latitudeDeg, longitudeDeg: 139.7, heightKm: 0, minElevationDeg: 10 };
}

const adhoc: IslEndpoint = {
  kind: "adhoc",
  name: "臨時",
  latitudeDeg: 1,
  longitudeDeg: 2,
  heightKm: 0,
  minElevationDeg: 5,
};

describe("reconcileIslEndpoints", () => {
  it("参照先の地上局が消えた endpoint は null(未設定)に初期化される", () => {
    const settings = {
      ...createDefaultIslSettings(),
      endpointA: stationEndpoint(gs("Tokyo", 35.7)),
      endpointB: stationEndpoint(gs("Osaka", 34.7)),
    };
    const next = reconcileIslEndpoints(settings, [gs("Tokyo", 35.7)]);
    expect(next.endpointA?.name).toBe("Tokyo");
    expect(next.endpointB).toBeNull();
  });

  it("同名局の定義変更(座標など)に追従して endpoint を最新化する", () => {
    const settings = {
      ...createDefaultIslSettings(),
      endpointA: stationEndpoint(gs("Tokyo", 35.7)),
      endpointB: null,
    };
    const next = reconcileIslEndpoints(settings, [gs("Tokyo", 36.0)]);
    expect(next.endpointA?.latitudeDeg).toBe(36.0);
  });

  it("adhoc(臨時地点)はシナリオ更新の影響を受けない", () => {
    const settings = { ...createDefaultIslSettings(), endpointA: adhoc, endpointB: null };
    const next = reconcileIslEndpoints(settings, []);
    expect(next.endpointA).toBe(adhoc);
  });

  it("変化がなければ同一の settings オブジェクトを返す(不要な再計算を防ぐ)", () => {
    const stations = [gs("Tokyo", 35.7)];
    const settings = {
      ...createDefaultIslSettings(),
      endpointA: stationEndpoint(stations[0]),
      endpointB: adhoc,
    };
    expect(reconcileIslEndpoints(settings, stations)).toBe(settings);
  });
});
