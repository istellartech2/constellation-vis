import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { version } from "echarts";
import {
  downloadHTML,
  downloadDualChartHTML,
  downloadMultiChartHTML,
} from "../src/components/analysis/utils/downloadUtils";

const originalDocument = globalThis.document;
afterEach(() => {
  globalThis.document = originalDocument;
  mock.restore();
});

describe("analysis HTML exports", () => {
  for (const count of [1, 2, 3]) {
    it(`exports ${count} charts with the installed ECharts runtime and executable initialization`, async () => {
      let captured: Blob | undefined;
      const click = mock(() => {});
      globalThis.document = {
        createElement: () => ({ click }),
      } as unknown as Document;
      spyOn(URL, "createObjectURL").mockImplementation((blob) => {
        captured = blob;
        return "blob:chart-export-test";
      });
      spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
      const options = Array.from({ length: count }, (_, i) => ({
        xAxis: { type: "category", data: ["00:00", "00:01"] },
        yAxis: { type: "value" },
        series: [{ type: "line", data: [i, i + 1] }],
      }));
      if (count === 1) downloadHTML(options[0], "検証", "report.html");
      else if (count === 2) downloadDualChartHTML(options[0], options[1], "検証", "report.html");
      else downloadMultiChartHTML(options, "検証", "report.html", "<p>Summary</p>");
      expect(click).toHaveBeenCalledTimes(1);
      const html = await captured!.text();
      expect(html).toContain(`echarts@${version}/dist/echarts.min.js`);
      expect(html).not.toContain("echarts@5.");
      if (count === 3) expect(html).toContain("<p>Summary</p>");
      const initialization = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].at(-1)![1];
      const rendered: unknown[] = [];
      const resize = mock(() => {});
      let onResize: (() => void) | undefined;
      // Execute the actual exported initialization, including its resize path.
      new Function("echarts", "document", "window", initialization)(
        { init: () => ({ setOption: (option: unknown) => rendered.push(option), resize }) },
        { getElementById: (id: string) => { expect(html).toContain(`id="${id}"`); return {}; } },
        { addEventListener: (_event: string, callback: () => void) => { onResize = callback; } },
      );
      expect(rendered).toEqual(options);
      onResize!();
      expect(resize).toHaveBeenCalledTimes(count);
    });
  }
});
