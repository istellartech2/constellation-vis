/** Links and reviewed interpretation notes only. No ITU database is redistributed. */
export interface FilingSystem {
  id: string;
  name: string;
  operator: string;
  description: string;
  /** Display order of filing families inside the system, e.g. generations. */
  series: { id: string; label: string; description?: string }[];
}
export interface FilingCatalogEntry {
  id: string;
  system: string;
  series: string;
  /** Network name as filed, e.g. USASAT-NGSO-3M. */
  name: string;
  /** Notifying administration, which may differ from the operator's home country. */
  country: string;
  agency: "ITU" | "FCC";
  url: string;
  /** Receipt or publication date: YYYY-MM-DD, or YYYY-MM when only the month is known. */
  date: string;
  reference?: string;
  /** Satellites declared on the submission page; alternatives inside one file are not summed here. */
  satellites?: number;
  submission?: string;
  description?: string;
  /** SHA-256 of the reviewed SNS MDB. Omitted for reference-only links without a placement. */
  sha256?: string;
  preferredConfiguration?: string;
  note?: string;
}

export const FILING_SYSTEMS: readonly FilingSystem[] = [
  { id: "starlink", name: "Starlink", operator: "SpaceX", description: "ネットワーク単位の申請。世代ごとに別の申請群で、合計は同時配備数ではありません。", series: [
    { id: "gen1", label: "第1世代", description: "2023年12月の通告（3A-R・3B-R・3D）" },
    { id: "gen2-2019", label: "第2世代（3M–3W）", description: "2019年に申請した20ネットワーク・計30,000機。2026年10月の変更申請" },
    { id: "gen2-3x", label: "第2世代（3X・3Y-1）", description: "FCCの第2世代申請と同じ29,988機の申請" },
    { id: "other", label: "その他の申請" },
  ] },
  { id: "kuiper", name: "Amazon Kuiper", operator: "Amazon（Kuiper Systems）", description: "第1世代の3ネットワークと、移動衛星業務（MSS）の申請。", series: [
    { id: "gen1", label: "第1世代（8A・8B・8C）" },
    { id: "mss", label: "MSS（8I）" },
  ] },
  { id: "oneweb", name: "OneWeb", operator: "Eutelsat OneWeb（WorldVu Satellites）", description: "英国が申請したネットワーク。", series: [
    { id: "gen1", label: "第1世代" },
  ] },
  { id: "guowang", name: "国網（Guowang）", operator: "中国衛星網絡集団（China SatNet）", description: "GW-A59 などの計画と、通告済みのネットワーク。", series: [
    { id: "notified", label: "通告" },
    { id: "plan", label: "計画（調整要求）" },
  ] },
  { id: "qianfan", name: "千帆（Qianfan）", operator: "上海垣信衛星（Spacesail）", description: "SAILSPACE 系列の申請。", series: [
    { id: "sailspace-1", label: "SAILSPACE-1" },
    { id: "sailspace-2", label: "SAILSPACE-2" },
  ] },
  { id: "honghu", name: "鴻鵠-3（Honghu-3）", operator: "Beijing LandSpace Hongqing Technology", description: "1万機規模の計画。", series: [
    { id: "default", label: "調整要求" },
  ] },
  { id: "bluebird", name: "BlueBird", operator: "", description: "AST SpaceMobile の衛星名と同名の申請。申請ページに同社の記載はなく、ドイツと日本から申請。", series: [
    { id: "default", label: "調整要求" },
  ] },
  { id: "opti", name: "OPTI", operator: "", description: "日本が申請した計画配置。", series: [
    { id: "default", label: "申請" },
  ] },
  { id: "spacex-odc", name: "SpaceX 宇宙データセンター", operator: "SpaceX", description: "FCCの公示。完全な配置は未取得。", series: [
    { id: "default", label: "FCC公示" },
  ] },
];

const ITU_PUBLICATION = "https://www.itu.int/ITU-R/space/asreceived/Publication/DisplayPublication/";
type ItuFields = Omit<FilingCatalogEntry, "id" | "agency" | "url">;
/** An ITU As-Received submission page; the id is the page's submission number. */
function itu(submissionId: number, fields: ItuFields): FilingCatalogEntry {
  return { id: `${fields.system}-${fields.reference!.toLowerCase()}`, agency: "ITU", url: ITU_PUBLICATION + submissionId, ...fields };
}
const MOD = "調整要求（変更）";
const STARLINK_GEN2: [number, string, string, number][] = [
  [72358, "USA2026-85146", "3M", 1875], [72359, "USA2026-85147", "3N", 1875], [72360, "USA2026-85148", "3O", 1875], [72361, "USA2026-85149", "3P", 1875],
  [72362, "USA2026-85150", "3Q", 1500], [72363, "USA2026-85151", "3R-1", 1250], [72364, "USA2026-85152", "3R-2", 1250], [72365, "USA2026-85153", "3R-3", 1500],
  [72366, "USA2026-85154", "3S-1", 1250], [72367, "USA2026-85155", "3S-2", 1500], [72368, "USA2026-85156", "3S-3", 1500], [72369, "USA2026-85157", "3T-1", 1250],
  [72370, "USA2026-85158", "3T-2", 1500], [72371, "USA2026-85159", "3T-3", 1250], [72372, "USA2026-85160", "3U-1", 1250], [72373, "USA2026-85161", "3U-2", 1500],
  [72374, "USA2026-85162", "3V-1", 1500], [72375, "USA2026-85163", "3V-2", 1500], [72376, "USA2026-85164", "3W-1", 1500],
];

export const FILING_CATALOG: readonly FilingCatalogEntry[] = [
  itu(54496, { system: "starlink", series: "gen1", name: "USASAT-NGSO-3A-R", country: "米国", reference: "USA2023-65539", date: "2023-12-28", satellites: 1584, submission: "通告" }),
  itu(54499, { system: "starlink", series: "gen1", name: "USASAT-NGSO-3B-R", country: "米国", reference: "USA2023-65542", date: "2023-12-28", satellites: 1584, submission: "通告" }),
  itu(54501, { system: "starlink", series: "gen1", name: "USASAT-NGSO-3D", country: "米国", reference: "USA2023-65544", date: "2023-12-28", satellites: 1512, submission: "通告" }),
  ...STARLINK_GEN2.map(([id, reference, suffix, satellites]) => itu(id, { system: "starlink", series: "gen2-2019", name: `USASAT-NGSO-${suffix}`, country: "米国", reference, date: "2026-10-13", satellites, submission: MOD })),
  itu(72598, { system: "starlink", series: "gen2-2019", name: "USASAT-NGSO-3W-2", country: "米国", reference: "USA2026-85395", date: "2026-10-15", satellites: 1500, submission: MOD, sha256: "ba81d996ed7ab434284be6f10970fe693296aa1b099924f9d9a59a916ec6ac34", preferredConfiguration: "default", note: "この申請ファイルには1,500機分の軌道情報があります。Starlinkの全機数や実際の運用位置ではありません。" }),
  itu(67474, { system: "starlink", series: "gen2-3x", name: "USASAT-NGSO-3X", country: "米国", reference: "USA2026-80102", date: "2026-02-04", satellites: 29988, submission: MOD, description: "1構成が10,000機を超える場合は表示できません。" }),
  itu(59302, { system: "starlink", series: "gen2-3x", name: "USASAT-NGSO-3Y-1", country: "米国", reference: "USA2024-70597", date: "2024-11-30", satellites: 29988, submission: "調整要求", description: "1構成が10,000機を超える場合は表示できません。" }),
  itu(69494, { system: "starlink", series: "other", name: "USASAT-NGSO-3-SX2", country: "米国", reference: "USA2026-82217", date: "2026-07-08", satellites: 4408, submission: "調整要求" }),
  itu(70030, { system: "kuiper", series: "gen1", name: "USASAT-NGSO-8A", country: "米国", reference: "USA2026-82773", date: "2026-08-25", satellites: 1154, submission: "通告（変更）" }),
  itu(70033, { system: "kuiper", series: "gen1", name: "USASAT-NGSO-8B", country: "米国", reference: "USA2026-82776", date: "2026-08-25", satellites: 1294, submission: "通告（変更）" }),
  itu(70034, { system: "kuiper", series: "gen1", name: "USASAT-NGSO-8C", country: "米国", reference: "USA2026-82777", date: "2026-08-25", satellites: 782, submission: "通告（変更）" }),
  itu(70805, { system: "kuiper", series: "mss", name: "USASAT-NGSO-8I", country: "米国", reference: "USA2026-83569", date: "2026-09-14", satellites: 11045, submission: "調整要求", description: "1構成が10,000機を超える場合は表示できません。" }),
  itu(66397, { system: "oneweb", series: "gen1", name: "L5", country: "英国", reference: "G2025-78993", date: "2025-12-18", satellites: 840, submission: "通告（変更）" }),
  itu(66848, { system: "guowang", series: "notified", name: "GW-1", country: "中国", reference: "CHN2025-79452", date: "2025-12-31", satellites: 870, submission: "通告" }),
  itu(65807, { system: "guowang", series: "notified", name: "GW-2", country: "中国", reference: "CHN2025-78365", date: "2025-11-07", satellites: 1728, submission: "通告" }),
  itu(66942, { system: "guowang", series: "notified", name: "GW-S", country: "中国", reference: "CHN2025-79546", date: "2025-12-31", satellites: 864, submission: "通告" }),
  itu(57455, { system: "guowang", series: "plan", name: "GW-A59", country: "中国", reference: "CHN2024-68636", date: "2024-07-17", satellites: 6080, submission: MOD }),
  itu(66787, { system: "qianfan", series: "sailspace-1", name: "SAILSPACE-1", country: "中国", reference: "CHN2025-79391", date: "2025-12-30", satellites: 1296, submission: MOD }),
  itu(54266, { system: "qianfan", series: "sailspace-2", name: "SAILSPACE-2-M", country: "中国", reference: "CHN2023-65298", date: "2023-12-16", satellites: 13904, submission: MOD, description: "1構成が10,000機を超える場合は表示できません。" }),
  itu(64212, { system: "bluebird", series: "default", name: "D-BLUEBIRD", country: "ドイツ", reference: "D2025-76740", date: "2025-10-03", satellites: 344, submission: "調整要求", description: "移動衛星業務（MSS）。" }),
  itu(56566, { system: "honghu", series: "default", name: "HONGHU-3", country: "中国", reference: "CHN2024-67702", date: "2024-05-24", satellites: 10000, submission: "調整要求" }),
  itu(70633, { system: "bluebird", series: "default", name: "J-BLUEBIRD-NGSO", country: "日本", reference: "J2026-83392", date: "2026-09-04", satellites: 136, submission: "調整要求" }),
  itu(68577, { system: "opti", series: "default", name: "OPTI-KANSEN", country: "日本", reference: "J2026-81256", date: "2026-04-30", description: "今回の変更対象は構成2の100機。", sha256: "50cd45f0cdba80e5169c7edbb7ce2cc1d99affccf34d3a1b726d0ce7b3ab7310", preferredConfiguration: "2", note: "添付注記NOTE 7：今回の変更は構成2のEPFD特性のみ。構成1の削除フラグは費用計算用で、計画の撤回を意味しません。両構成を合計した200機を同時配備として扱いません。" }),
  itu(68546, { system: "opti", series: "default", name: "OPTI-K-V", country: "日本", reference: "J2026-81225", date: "2026-04-30", description: "主な傾斜角が40°・46°・50°の3つの代替構成。", sha256: "ab918763474abab8314a05a43c529bfeaddc6a6f2bdbcb16e04b3b3bf82c1c4f", preferredConfiguration: "1", note: "添付注記NOTE 9：3構成は排他的な代替案です。各579機を合計した1,737機が同時に配備されるという意味ではありません。変更申請なので過去の申請全体を網羅するとは限りません。" }),
  { id: "spacex-orbital-data-center", system: "spacex-odc", series: "default", name: "SpaceX 宇宙データセンター", country: "米国", agency: "FCC", url: "https://docs.fcc.gov/public/attachments/DA-26-113A1.pdf", date: "2026-02", description: "最大100万機・高度500〜2,000 kmの範囲のみで、完全な配置は未取得。ITU申請との対応も未確認。" },
];

/** True when the entry links to an SNS MDB the importer can place. */
export function hasPlacement(entry: FilingCatalogEntry): boolean { return entry.agency === "ITU"; }
const normalize = (text: string) => text.normalize("NFKC").toLowerCase();
export interface FilingCatalogGroup {
  system: FilingSystem;
  series: { id: string; label: string; description?: string; entries: FilingCatalogEntry[] }[];
  count: number;
}
/**
 * Group matches by system and series in catalog order. Every whitespace-separated
 * term must match the entry or its system/series labels.
 */
export function searchFilingCatalog(entries: readonly FilingCatalogEntry[], query: string, country = "", systems: readonly FilingSystem[] = FILING_SYSTEMS): FilingCatalogGroup[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return systems.flatMap(system => {
    const series = system.series.map(s => ({
      ...s,
      entries: entries
        .filter(entry => entry.system === system.id && entry.series === s.id && (!country || entry.country === country))
        .filter(entry => {
          const haystack = normalize([system.name, system.operator, s.label, entry.name, entry.country, entry.agency, entry.reference ?? "", entry.submission ?? "", entry.description ?? ""].join(" "));
          return terms.every(term => haystack.includes(term));
        })
        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }) || b.date.localeCompare(a.date)),
    })).filter(s => s.entries.length);
    const count = series.reduce((sum, s) => sum + s.entries.length, 0);
    return count ? [{ system, series, count }] : [];
  });
}
