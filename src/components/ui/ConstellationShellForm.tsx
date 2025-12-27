import type { ConstellationShell } from "../../lib/constellationTypes";
import type { ValidationError } from "../../lib/constellationSerializer";
import { Label } from "./label";

interface Props {
  shell: ConstellationShell;
  errors: ValidationError[];
  onChange: (updates: Partial<ConstellationShell>) => void;
}

export default function ConstellationShellForm({ shell, errors, onChange }: Props) {
  const getError = (field: string): string | undefined => {
    const prefix = `shell.`;
    for (const err of errors) {
      if (err.field.endsWith(`.${field}`) || err.field.startsWith(prefix) && err.field.endsWith(field)) {
        return err.message;
      }
    }
    return undefined;
  };

  const handleNumberChange = (
    field: keyof ConstellationShell,
    value: string,
    isInteger: boolean = false
  ) => {
    const num = isInteger ? parseInt(value, 10) : parseFloat(value);
    if (!isNaN(num)) {
      onChange({ [field]: num });
    }
  };

  return (
    <div className="space-y-4 p-4 h-full overflow-y-auto">
      <div className="text-sm font-medium text-gray-100 border-b border-gray-600 pb-2">
        シェル詳細
      </div>

      {/* Name */}
      <div className="space-y-1">
        <Label className="text-xs text-gray-400">名前</Label>
        <input
          type="text"
          value={shell.name ?? ""}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="例: LEO-500km-43deg"
          className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
        />
      </div>

      {/* Count & Planes row */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs text-gray-400">衛星数</Label>
          <input
            type="number"
            min={1}
            step={1}
            value={shell.count}
            onChange={(e) => handleNumberChange("count", e.target.value, true)}
            className={`w-full px-2 py-1.5 text-sm bg-gray-800 border rounded focus:outline-none text-gray-100 ${
              getError("count") ? "border-red-500" : "border-gray-600 focus:border-amber-500"
            }`}
          />
          {getError("count") && (
            <p className="text-xs text-red-400">{getError("count")}</p>
          )}
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-gray-400">軌道面数</Label>
          <input
            type="number"
            min={1}
            step={1}
            value={shell.planes}
            onChange={(e) => handleNumberChange("planes", e.target.value, true)}
            className={`w-full px-2 py-1.5 text-sm bg-gray-800 border rounded focus:outline-none text-gray-100 ${
              getError("planes") ? "border-red-500" : "border-gray-600 focus:border-amber-500"
            }`}
          />
          {getError("planes") && (
            <p className="text-xs text-red-400">{getError("planes")}</p>
          )}
        </div>
      </div>

      <div className="border-t border-gray-700 pt-3 mt-3">
        <div className="text-xs font-medium text-gray-400 mb-3">軌道パラメータ</div>

        {/* Altitude - number input only */}
        <div className="space-y-1 mb-3">
          <Label className="text-xs text-gray-400">高度 (km)</Label>
          <input
            type="number"
            min={0}
            max={100000}
            step={10}
            value={shell.apogee_altitude ?? 0}
            onChange={(e) => handleNumberChange("apogee_altitude", e.target.value)}
            className={`w-full px-2 py-1.5 text-sm bg-gray-800 border rounded focus:outline-none text-gray-100 ${
              getError("apogee_altitude") ? "border-red-500" : "border-gray-600 focus:border-amber-500"
            }`}
          />
          {getError("apogee_altitude") && (
            <p className="text-xs text-red-400">{getError("apogee_altitude")}</p>
          )}
        </div>

        {/* Eccentricity */}
        <div className="space-y-1 mb-3">
          <Label className="text-xs text-gray-400">離心率</Label>
          <input
            type="number"
            min={0}
            max={0.999999}
            step={0.0001}
            value={shell.eccentricity ?? 0}
            onChange={(e) => handleNumberChange("eccentricity", e.target.value)}
            className={`w-full px-2 py-1.5 text-sm bg-gray-800 border rounded focus:outline-none text-gray-100 ${
              getError("eccentricity") ? "border-red-500" : "border-gray-600 focus:border-amber-500"
            }`}
          />
          {getError("eccentricity") && (
            <p className="text-xs text-red-400">{getError("eccentricity")}</p>
          )}
          <p className="text-xs text-gray-500">0 = 円軌道</p>
        </div>

        {/* Inclination - number input only */}
        <div className="space-y-1 mb-3">
          <Label className="text-xs text-gray-400">軌道傾斜角 (度)</Label>
          <input
            type="number"
            min={0}
            max={180}
            step={0.1}
            value={shell.inclination ?? 0}
            onChange={(e) => handleNumberChange("inclination", e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
          />
        </div>
      </div>

      <div className="border-t border-gray-700 pt-3 mt-3">
        <div className="text-xs font-medium text-gray-400 mb-3">RAAN（昇交点赤経）設定</div>

        {/* RAAN Start */}
        <div className="space-y-1 mb-3">
          <Label className="text-xs text-gray-400">RAAN開始角 (度)</Label>
          <input
            type="number"
            min={0}
            max={360}
            step={0.1}
            value={shell.raan_start ?? 0}
            onChange={(e) => handleNumberChange("raan_start", e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
          />
          <p className="text-xs text-gray-500">最初の軌道面のRAANを指定</p>
        </div>

        {/* RAAN Range with slider */}
        <div className="space-y-1 mb-3">
          <div className="flex justify-between">
            <Label className="text-xs text-gray-400">RAAN分布範囲 (度)</Label>
            <span className="text-xs text-gray-400">{(shell.raan_range ?? 360).toFixed(1)}°</span>
          </div>
          <div className="flex gap-2 items-center">
            <input
              type="range"
              min={0}
              max={360}
              step={1}
              value={shell.raan_range ?? 360}
              onChange={(e) => handleNumberChange("raan_range", e.target.value)}
              className="flex-1 h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-amber-500"
            />
            <input
              type="number"
              min={0}
              max={360}
              step={1}
              value={shell.raan_range ?? 360}
              onChange={(e) => handleNumberChange("raan_range", e.target.value)}
              className="w-24 px-2 py-1 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
            />
          </div>
          <p className="text-xs text-gray-500">軌道面をこの範囲に均等配置</p>
        </div>

        {/* Phasing - moved here below RAAN */}
        <div className="space-y-1">
          <Label className="text-xs text-gray-400">フェージング係数 (F)</Label>
          <input
            type="number"
            min={0}
            step={1}
            value={shell.phasing ?? 0}
            onChange={(e) => handleNumberChange("phasing", e.target.value, true)}
            className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
          />
          <p className="text-xs text-gray-500">
            隣接軌道面間の衛星位相オフセット。0〜(軌道面数-1)の整数。
            0=同位相、1=1衛星分ずれ。均等カバレッジには1が一般的。
          </p>
        </div>
      </div>

      <div className="border-t border-gray-700 pt-3 mt-3">
        <div className="text-xs font-medium text-gray-400 mb-3">詳細パラメータ</div>

        {/* Argument of Perigee */}
        <div className="space-y-1 mb-3">
          <Label className="text-xs text-gray-400">近地点引数 (度)</Label>
          <input
            type="number"
            min={0}
            max={360}
            step={0.1}
            value={shell.argp ?? 0}
            onChange={(e) => handleNumberChange("argp", e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
          />
        </div>

        {/* Mean Anomaly */}
        <div className="space-y-1">
          <Label className="text-xs text-gray-400">平均近点角 (度)</Label>
          <input
            type="number"
            min={0}
            max={360}
            step={0.1}
            value={shell.mean_anomaly_0 ?? 0}
            onChange={(e) => handleNumberChange("mean_anomaly_0", e.target.value)}
            className="w-full px-2 py-1.5 text-sm bg-gray-800 border border-gray-600 rounded focus:border-amber-500 focus:outline-none text-gray-100"
          />
          <p className="text-xs text-gray-500">最初の衛星の初期位相</p>
        </div>
      </div>
    </div>
  );
}
