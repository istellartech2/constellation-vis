import type { LaunchSiteImageryCredit as Credit } from "../../lib/launchSiteImagery";

interface Props {
  credit: Credit | null;
}

const linkClass = "pointer-events-auto underline decoration-white/40 underline-offset-2";
// The global (unlayered) `a` colour in index.css outranks utility classes.
const linkStyle = { color: "inherit", fontWeight: 400 } as const;

/**
 * Credit for the launch-site imagery patches, shown only while one is drawn.
 * It sits in the bottom-right corner, in the strip below the playback bar /
 * tour controls; narrow screens get a shorter one-line form (the full credit
 * is in its title and in public/assets/launch-sites/README.md).
 */
export default function LaunchSiteImageryCredit({ credit }: Props) {
  if (!credit) return null;
  const { year } = credit;
  const licenseUrl = credit.licenseUrl || "https://creativecommons.org/licenses/by/4.0/";
  const license = credit.license || "CC BY 4.0";
  return (
    <div
      className="pointer-events-none fixed right-0 bottom-0 z-[35] max-w-full truncate px-2 pb-[env(safe-area-inset-bottom,0px)] text-[9px] leading-3 text-white/75 [text-shadow:0_0_3px_rgba(0,0,0,0.9)] sm:text-[10px]"
      role="note"
      aria-label="衛星画像の出典"
      title={credit.attribution || undefined}
    >
      <span className="max-sm:hidden">
        画像: <a className={linkClass} style={linkStyle} href="https://cloudless.eox.at" target="_blank" rel="noreferrer">EOxCloudless {year} (cloudless.eox.at)</a> by EOX IT Services GmbH, Copernicus Sentinel データ ({year}) を加工,{" "}
        <a className={linkClass} style={linkStyle} href={licenseUrl} target="_blank" rel="license noreferrer">{license}</a>
      </span>
      <span className="sm:hidden">
        画像: <a className={linkClass} style={linkStyle} href="https://cloudless.eox.at" target="_blank" rel="noreferrer">EOxCloudless {year}</a> by EOX · Copernicus Sentinel {year} 加工 ·{" "}
        <a className={linkClass} style={linkStyle} href={licenseUrl} target="_blank" rel="license noreferrer">{license}</a>
      </span>
    </div>
  );
}
