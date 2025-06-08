// Download utility functions for analysis components

export function downloadPNG(chartRef: any, filename: string) {
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
}

export function downloadHTML(chartOption: any, title: string, filename: string) {
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

export function downloadCSV(headers: string[], rows: any[][], filename: string) {
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

export function downloadDualChartHTML(
  chart1Option: any,
  chart2Option: any,
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