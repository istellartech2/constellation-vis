# レポート ― 軌道要素に対する摂動（J₂・J₃・大気抗力）

`src/lib/perturbation.ts` が使う J2 / J3 / 抗力の簡易レート式を説明する。用途は衛星情報のレート表示と [軌道維持解析](analysis-implementation.md#maintenance) で、SGP4 の位置伝播へは加算しない。全体像は [計算の概要](how-it-works.md) を参照。

---

## 0. 対象範囲と記号

| 記号      | 意味（単位：SI 系）                                                  |
| ------- | ------------------------------------------------------------ |
| μ       | 地球の重力定数 GM = 3.986 004 418 × 10¹⁴ m³ s⁻²                   |
| Rₑ      | 地球赤道半径 = 6 378 137 m                                       |
| J₂, J₃  | 第 2 次・第 3 次ゾーナル調和項（J₂ ≈ 1.082 63 × 10⁻³, J₃ ≈ –2.532 × 10⁻⁶） |
| a, e, i | 半長軸，離心率，軌道傾斜角                                                |
| Ω       | 昇交点赤経（RAAN）                                                  |
| ω       | 近地点引数                                                        |
| M       | 平均近点角                                                        |
| n       | ケプラー平均運動 = √(μ / a³)                                         |
| B       | 弾道係数 = C\_D A ⁄ m（m² kg⁻¹）                                   |
| ρ       | 局所大気密度（kg m⁻³）                                               |
| v\_rel  | 大気に対する相対速度（m s⁻¹）                                            |

以下は **現在の実装が使うレート式** を示す。角度は rad、長さは m、式の時間単位は s。短周期成分は省略。標準理論の厳密な導出や独立した精度保証とは区別する。`PerturbationRates` の出力は a が km/year、e が /year、i・Ω・ω が deg/year、M だけ deg/day。年は 365.25 日。

---

## 1. J₂ による摂動（第 2 次ゾーナル）

```
k2 = 1.5 * J2 * (R_e^2)
β  = (1 - e^2)^2
dΩ/dt = - k2 * n * cos(i) / (a^2 * β)                     (1)
dω/dt =   k2 * n * (2 - 2.5 * sin(i)^2) / (a^2 * β)       (2)
dM/dt =   n + k2 * n * (1 - 3 * sin(i)^2) / (2 * a^2 * β) (3)
da/dt = de/dt = di/dt = 0   （一次近似）
```

*式 (1)* は昇交点の歳差（順行軌道では西向き）。
*式 (2)* は近地点引数のドリフト（臨界傾斜 63.4° でゼロ）。
*式 (3)* は Kepler 項 n を含む実装の平均近点角レート。標準的な一次 J2 補正とは異なる。[RGT §4.1](RGTorbit.md#implemented-rates) に両式の比較をまとめている。

---

## 2. J₃ による摂動（第 3 次ゾーナル）

```
k3 = 0.5 * J3 * (R_e^3)
γ  = (1 - e^2)^3
dΩ/dt += - k3 * n * sin(i) / (a^3 * γ)                         (4)
dω/dt +=   k3 * n * (4 - 5 * sin(i)^2) * sin(i) / (2*a^3*γ)    (5)
de/dt  =   k3 * n * (1.5 * sin(i)^2 - 1) * e / (a^3 * γ)       (6)
di/dt  =   k3 * n * cos(i) / (2 * a^3 * γ)                     (7)
```

J₃ は地球の南北非対称を表す。ただし上記はコードの簡易式であり、一般の J3 長周期理論との対応は未検証。実装は入力の ω を使わないため、近地点向きに依存する長周期変化や frozen orbit 条件を表現するモデルとは扱えない。Python フィクスチャも同じ式を使うので、テスト合格だけでは物理的な妥当性を確認できない。

---

## 3. 大気抵抗による摂動

速度と逆向きに働く抗力加速度 **a\_d** を

```
a_d = -½ * ρ * v_rel^2 * B * v̂
```

とすると、ガウス変分方程式を周回平均して主要項だけ残すと：

```
F = ½ * ρ * v_rel * B              # 抗力「レート」[1/s]。v_rel は 1 次（2 乗ではない）
da/dt = -2 * a * F                 (8)
de/dt = (da/dt) * e / (2 * H)      (9)
di/dt, dΩ/dt, dω/dt ≈ 0（抗力はほぼ対称）
```

**式 (8) の次元と等価形**：F は加速度ではなく 1/s の「レート」である。この定義なら
式 (8) は円軌道の永年減衰の教科書形

```
da/dt = -ρ * B * sqrt(μ * a)       (8')
```

に恒等的に一致する（抗力の消費電力を全エネルギー -μ/(2a) の時間微分と等置して導出）。
`F` は抗力加速度ではなくレートとして定義する。`src/lib/perturbation.test.ts` は、式 (8) と (8') の一致を検証する。

**式 (9)**：King-Hele の小離心率極限。指数大気では遠地点のほうが速く落ちるので軌道は
円化する。**H** は局所密度スケールハイト（指数モデルなら設定値、Harris-Priester なら
テーブルの対数勾配から算出）。e = 0 で厳密に 0、小 e で e に比例する。

*大気密度 ρ*：実装は次の 2 種。NRLMSISE-00 は実装していない。

- 指数モデル（関数既定）: `rho = rho0 * densityMultiplier * exp(-(h-h0)/H)`。既定 h0 = 400 km、H = 60 km、rho0 = 1e-12 kg/m³。
- Harris-Priester 風モデル（軌道維持 UI で固定）: 150〜1500 km の単一密度テーブルを対数線形補間し、F10.7 / Ap / 日変化係数の固定倍率を掛ける。範囲外は端点密度に固定。本来の min/max テーブルと太陽方向依存を持つ Harris-Priester ではない。倍率は次式。F10.7 と Ap は入力した固定値を使い、時系列の宇宙天気データは取得しない。

```
solarFactor       = max(0.35, 1 + 0.004*(F10.7 - 150))
geomagneticFactor = 1 + 0.02*sqrt(Ap)
diurnalFactor     = 0.85 + 0.3*diurnalBulgeFactor
rho = table(h) * solarFactor * geomagneticFactor * diurnalFactor * densityMultiplier
```

既定値は F10.7 = 150、Ap = 15、diurnalBulgeFactor = 0.5、densityMultiplier = 1。Harris-Priester 風モデルの H はテーブルの対数勾配 `-(dh)/(d ln rho)` から求める。

*h*：`a*(1-e)-R_e`（近地点高度）を周回全体の代表として使い、h < 1000 km の場合にだけ抗力を適用する（上限は設定可、軌道維持解析では 1500 km に上書き）。
*v_rel*：円軌道近似 `sqrt(mu/a)` のみ。大気の共回転は差し引かない。

高離心率では近地点の密度を全周回へ適用する誤差が大きくなり得る。密度・寿命・維持 ΔV に対する一律の誤差倍率や実測精度は保証されていない。

---

## 4. 擬似コード例（モデルの理解用、実際の伝播器ではない）

```python
# 入力: a, e, i, Ω, ω, M (単位: rad, m)、タイムステップ dt (s)、反復回数 N
mu  = 3.986004418e14
Re  = 6378137.0
J2  = 1.08263e-3
J3  = -2.532e-6
CdA_over_m = 0.012  # 例としての弾道係数 B

for step in range(N):
    n = (mu / a**3) ** 0.5
    beta  = (1 - e**2)**2
    gamma = (1 - e**2)**3
    k2 = 1.5 * J2 * Re**2
    k3 = 0.5 * J3 * Re**3

    # ---- J2 ----
    dΩ = (-k2 * n * math.cos(i) / (a**2 * beta)) * dt
    dω = ( k2 * n * (2 - 2.5 * math.sin(i)**2) / (a**2 * beta)) * dt
    dM = ( n + k2 * n * (1 - 3 * math.sin(i)**2) / (2 * a**2 * beta) ) * dt

    # ---- J3 ----
    dΩ += (-k3 * n * math.sin(i) / (a**3 * gamma)) * dt
    dω += ( k3 * n * (4 - 5 * math.sin(i)**2) * math.sin(i) / (2*a**3*gamma)) * dt
    de  = ( k3 * n * (1.5 * math.sin(i)**2 - 1) * e / (a**3 * gamma) ) * dt
    di  = ( k3 * n * math.cos(i) / (2 * a**3 * gamma) ) * dt

    # ---- 大気抵抗 ----
    h = a * (1 - e) - Re                    # 近地点高度（粗い近似）
    rho = rho0 * math.exp(-(h - h0)/H)      # 簡易モデル
    v_rel = (mu / a) ** 0.5                 # 平均速度
    F = 0.5 * rho * v_rel * CdA_over_m      # [1/s]。v_rel は 1 次（式 8 を参照）
    da  = -2 * a * F * dt                   # == -rho * B * sqrt(mu * a) * dt
    de += (-2 * a * F) * e / (2 * H) * dt   # King-Hele 小 e 極限（式 9）

    # ---- 更新 ----
    a += da
    e += de
    i += di
    Ω += dΩ
    ω += dω
    M += dM
```

**メモ**

* ρ₀, h₀, H は大気モデルに応じて設定。
* さらに高精度が必要な場合は、Runge–Kutta 4 などで **a\_J2**, **a\_J3**, **a\_drag** を
  デカルト座標で加える完全数値積分という選択肢もある（一般論としての参考情報であり、
  **本アプリでは採用していない**。上記「位置づけ」のとおり伝播は SGP4）。

---

## 5. 参考文献（邦題略）

以下は背景理論の参考文献であり、特に式 (3)〜(7) の出典箇所を特定した検証は残っている。

1. Vallado, *Fundamentals of Astrodynamics and Applications*, 4th ed.
2. Montenbruck & Gill, *Satellite Orbits*.
3. Wertz et al., *Space Mission Engineering*.
4. Hoots & Roehrich, *Spacetrack Report No. 3 — Models for Propagation of NORAD Element Sets*, 1980
   ― SGP4/SDP4 の公式仕様（本アプリの伝播器）。

---

*実装照合: 2026-10-14*
