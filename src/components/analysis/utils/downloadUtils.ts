// Download utility functions for analysis components
import type { MutableRefObject } from "react";
import type ReactECharts from "echarts-for-react";
import type { ECBasicOption } from "echarts/types/dist/shared";

type ChartComponentRef = MutableRefObject<InstanceType<typeof ReactECharts> | null>;

export function downloadPNG(chartRef: ChartComponentRef, filename: string) {
  if (!chartRef.current) return;

  const chartInstance = chartRef.current.getEchartsInstance();
  const url = chartInstance.getDataURL({
    type: 'png',
    pixelRatio: 2,
    backgroundColor: 'rgba(30, 32, 36, 0.95)'
  });

  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadHTML(chartOption: ECBasicOption, title: string, filename: string) {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${title}</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; padding: 30px; background: #141518; }
        #chart { width: 100%; height: 600px; }
        h1 { color: #ed6d00; font-family: Arial, sans-serif; text-align: center; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <div id="chart"></div>
    <script>
        var chart = echarts.init(document.getElementById('chart'), 'dark');
        var option = ${JSON.stringify(chartOption, null, 2)};
        chart.setOption(option);
        window.addEventListener('resize', function() {
            chart.resize();
        });
    </script>
</body>
</html>`;
  
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadCSV(headers: string[], rows: Array<Array<string | number>>, filename: string) {
  const csvRows = [headers.join(',')];
  
  rows.forEach(row => {
    csvRows.push(row.join(','));
  });
  
  const csvContent = csvRows.join('\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadJSON(data: unknown, filename: string) {
  const jsonContent = JSON.stringify(data, null, 2);
  const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadDualChartHTML(
  chart1Option: ECBasicOption,
  chart2Option: ECBasicOption,
  title: string,
  filename: string
) {
  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${title}</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; padding: 30px; background: #141518; color: #f1f1f1; font-family: Arial, sans-serif; }
        .chart-container { display: flex; gap: 20px; height: 600px; }
        .chart { flex: 1; }
        h1 { color: #ed6d00; text-align: center; margin-bottom: 30px; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    <div class="chart-container">
        <div id="chart1" class="chart"></div>
        <div id="chart2" class="chart"></div>
    </div>
    <script>
        var chart1 = echarts.init(document.getElementById('chart1'), 'dark');
        var chart2 = echarts.init(document.getElementById('chart2'), 'dark');
        var option1 = ${JSON.stringify(chart1Option, null, 2)};
        var option2 = ${JSON.stringify(chart2Option, null, 2)};
        chart1.setOption(option1);
        chart2.setOption(option2);
        window.addEventListener('resize', function() {
            chart1.resize();
            chart2.resize();
        });
    </script>
</body>
</html>`;
  
  const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export function downloadMultiChartHTML(
  chartOptions: ECBasicOption[],
  title: string,
  filename: string,
  summaryHtml?: string,
) {
  const chartDivs = chartOptions
    .map((_, index) => `<div id="chart${index + 1}" class="chart"></div>`)
    .join("");
  const chartInit = chartOptions
    .map((option, index) => `
        var chart${index + 1} = echarts.init(document.getElementById('chart${index + 1}'), 'dark');
        var option${index + 1} = ${JSON.stringify(option, null, 2)};
        chart${index + 1}.setOption(option${index + 1});`)
    .join("\n");
  const resizeCall = chartOptions
    .map((_, index) => `chart${index + 1}.resize();`)
    .join("\n            ");

  const htmlContent = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>${title}</title>
    <script src="https://cdn.jsdelivr.net/npm/echarts@5.4.3/dist/echarts.min.js"></script>
    <style>
        body { margin: 0; padding: 30px; background: #141518; color: #f1f1f1; font-family: Arial, sans-serif; }
        h1 { color: #ed6d00; text-align: center; margin-bottom: 20px; }
        .summary { max-width: 960px; margin: 0 auto 24px; padding: 16px; border: 1px solid #374151; border-radius: 8px; background: rgba(31, 41, 55, 0.7); }
        .charts { display: grid; grid-template-columns: 1fr; gap: 24px; }
        .chart { width: 100%; height: 460px; }
        table { border-collapse: collapse; width: 100%; }
        td, th { border: 1px solid #4b5563; padding: 8px; text-align: left; }
        th { color: #ed6d00; }
    </style>
</head>
<body>
    <h1>${title}</h1>
    ${summaryHtml ? `<div class="summary">${summaryHtml}</div>` : ""}
    <div class="charts">
      ${chartDivs}
    </div>
    <script>
${chartInit}
        window.addEventListener('resize', function() {
            ${resizeCall}
        });
    </script>
</body>
</html>`;

  const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}
